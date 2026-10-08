import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { it } from "remix/test";
import * as assert from "remix/assert";
import { files, folders, jobs, sessions, users } from "#db";
import { setDbForTesting } from "#db/connection.server";
import {
  applyMigrations,
  createTestDatabase,
} from "../../../../__tests__/db.ts";

it("resumes chunks, enforces ownership, commits once, and ingests in a durable job", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "artbin-tus-test-"));
  process.env.NODE_ENV = "test";
  process.env.ARTBIN_REQUIRE_AUTH = "1";
  process.env.ARTBIN_PUBLIC_DIR = join(runtime, "public");
  process.env.ARTBIN_TEMP_DIR = join(runtime, "temp");
  const database = createTestDatabase();
  applyMigrations(database.sqlite);
  setDbForTesting(database.db);
  const { router } = await import("../../../router.ts");
  const { routes } = await import("../../../routes.ts");
  const { processJob } = await import("#lib/jobs.server");
  await import("#lib/jobs/extract-job.server");
  const { recoverUploadJobs } = await import("#lib/jobs/upload-jobs.server");
  const { getTusServer, cleanupTusUploads } = await import("#lib/tus.server");
  const origin = "http://artbin.test";
  const send = (
    path: string,
    method: string,
    headers: Record<string, string> = {},
    body?: BodyInit,
  ) =>
    router
      .fetch(
        new Request(new URL(path, origin), {
          method,
          headers: {
            Cookie: "artbin_session=owner",
            "Tus-Resumable": "1.0.0",
            ...headers,
          },
          body,
        }),
      )
      .catch((error) => {
        if (error instanceof Response) return error;
        throw error;
      });
  try {
    await database.db.insert(users).values([
      { id: "owner", username: "owner", fourmId: "owner", isAdmin: true },
      { id: "other", username: "other", fourmId: "other" },
    ]);
    await database.db.insert(sessions).values([
      {
        id: "owner",
        userId: "owner",
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: "other",
        userId: "other",
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    await database.db
      .insert(folders)
      .values({ id: "dest", slug: "destination", name: "Destination" });
    const bytes = "hello world";
    const metadata = {
      purpose: "file",
      parentFolder: "destination",
      path: "hello.txt",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const encoded = Object.entries(metadata)
      .map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`)
      .join(",");
    assert.equal(
      (await send(routes.api.uploads.href(), "POST", { Cookie: "" })).status,
      401,
    );
    const created = await send(routes.api.uploads.href(), "POST", {
      "Upload-Length": String(bytes.length),
      "Upload-Metadata": encoded,
    });
    assert.equal(created.status, 201);
    assert.equal(
      (
        await send(routes.api.uploads.href(), "POST", {
          "Upload-Length": String(512 * 1024 * 1024 + 1),
          "Upload-Metadata": encoded,
        })
      ).status,
      413,
    );
    const location = created.headers.get("location")!;
    const id = location.split("/").pop()!;
    assert.equal(
      (await send(location, "HEAD", { Cookie: "artbin_session=other" })).status,
      404,
    );
    assert.equal(
      (
        await send(
          location,
          "PATCH",
          {
            "Upload-Offset": "0",
            "Content-Type": "application/offset+octet-stream",
          },
          "hello ",
        )
      ).status,
      204,
    );
    assert.equal(
      (await send(location, "HEAD")).headers.get("Upload-Offset"),
      "6",
    );
    const commitPath = routes.api.commitUpload.href({ uploadId: id });
    assert.equal((await send(commitPath, "POST")).status, 409);
    assert.equal(
      (
        await send(
          location,
          "PATCH",
          {
            "Upload-Offset": "0",
            "Content-Type": "application/offset+octet-stream",
          },
          "world",
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await send(
          location,
          "PATCH",
          {
            "Upload-Offset": "6",
            "Content-Type": "application/offset+octet-stream",
          },
          "world",
        )
      ).status,
      204,
    );
    assert.equal((await database.db.select().from(files)).length, 0);
    assert.equal(
      (await send(commitPath, "POST", { Cookie: "artbin_session=other" }))
        .status,
      404,
    );
    const committed = await send(commitPath, "POST");
    assert.equal(committed.status, 202);
    const { jobId } = (await committed.json()) as { jobId: string };
    await send(commitPath, "POST");
    const queued = await database.db.select().from(jobs);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]!.status, "pending");
    await database.db
      .update(jobs)
      .set({ status: "running" })
      .where(eq(jobs.id, jobId));
    await recoverUploadJobs();
    assert.equal((await database.db.select().from(jobs))[0]!.status, "pending");
    await cleanupTusUploads();
    assert.equal(
      (await getTusServer().datastore.getUpload(id)).offset,
      bytes.length,
    );
    assert.equal((await processJob(queued[0]!)).isOk(), true);
    assert.equal(
      await readFile(
        join(runtime, "public/uploads/destination/hello.txt"),
        "utf8",
      ),
      bytes,
    );
    const statusPath = routes.api.uploadJob.href({ jobId });
    assert.equal(
      (await send(statusPath, "GET", { Cookie: "artbin_session=other" }))
        .status,
      404,
    );
    assert.equal(
      ((await (await send(statusPath, "GET")).json()) as { status: string })
        .status,
      "completed",
    );
    await cleanupTusUploads();
    await assert.rejects(() => getTusServer().datastore.getUpload(id));
    assert.equal((await send(commitPath, "POST")).status, 202);
    const finalize = await send(
      routes.api.finalizeUploads.href(),
      "POST",
      { "Content-Type": "application/json" },
      JSON.stringify({ parentFolder: "destination" }),
    );
    assert.equal(finalize.status, 202);
    const finalizeJob = (await database.db.select().from(jobs)).find(
      (job) => job.type === "upload-finalize",
    )!;
    assert.equal(finalizeJob.status, "pending");
    assert.equal((await processJob(finalizeJob)).isOk(), true);

    // A successful transfer is not a successful import until the checksum is checked.
    const badMetadata = encoded.replace(
      Buffer.from(metadata.sha256).toString("base64"),
      Buffer.from("0".repeat(64)).toString("base64"),
    );
    const badCreate = await send(routes.api.uploads.href(), "POST", {
      "Upload-Length": "1",
      "Upload-Metadata": badMetadata,
    });
    const badLocation = badCreate.headers.get("location")!;
    const badId = badLocation.split("/").pop()!;
    await send(
      badLocation,
      "PATCH",
      {
        "Upload-Offset": "0",
        "Content-Type": "application/offset+octet-stream",
      },
      "x",
    );
    await send(routes.api.commitUpload.href({ uploadId: badId }), "POST");
    const badJob = (await database.db.select().from(jobs)).find(
      (job) => job.id === `process-upload-${badId}`,
    )!;
    assert.equal((await processJob(badJob)).isErr(), true);
    const failure = (await (
      await send(routes.api.uploadJob.href({ jobId: badJob.id }), "GET")
    ).json()) as { status: string; error: string };
    assert.equal(failure.status, "failed");
    assert.match(failure.error, /checksum/);
    assert.equal(
      await readFile(
        join(runtime, "public/uploads/destination/hello.txt"),
        "utf8",
      ),
      bytes,
    );
    const createAndQueue = async (
      path: string,
      content: Buffer,
      cookie = "owner",
      extra: Record<string, string> = {},
    ) => {
      const meta = {
        ...(extra.purpose === "archive" ? { purpose: "archive" } : metadata),
        ...extra,
        path,
        sha256: createHash("sha256").update(content).digest("hex"),
      };
      const headers = {
        Cookie: `artbin_session=${cookie}`,
        "Upload-Length": String(content.length),
        "Upload-Metadata": Object.entries(meta)
          .map(
            ([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`,
          )
          .join(","),
      };
      const response = await send(routes.api.uploads.href(), "POST", headers);
      assert.equal(response.status, 201);
      const pathUrl = response.headers.get("location")!;
      const uploadId = pathUrl.split("/").pop()!;
      assert.equal(
        (
          await send(
            pathUrl,
            "PATCH",
            {
              Cookie: headers.Cookie,
              "Upload-Offset": "0",
              "Content-Type": "application/offset+octet-stream",
            },
            new Uint8Array(content),
          )
        ).status,
        204,
      );
      await send(routes.api.commitUpload.href({ uploadId }), "POST", {
        Cookie: headers.Cookie,
      });
      return (await database.db.select().from(jobs)).find(
        (job) => job.id === `process-upload-${uploadId}`,
      )!;
    };
    const conflict = await createAndQueue(
      "hello.txt",
      Buffer.from("different contents"),
    );
    assert.equal((await processJob(conflict)).isErr(), true);
    assert.equal(
      await readFile(
        join(runtime, "public/uploads/destination/hello.txt"),
        "utf8",
      ),
      bytes,
    );
    const pendingJob = await createAndQueue(
      "member.txt",
      Buffer.from("pending"),
      "other",
    );
    assert.equal((await processJob(pendingJob)).isOk(), true);
    // Re-running after a process interruption reuses the same inbox folder and file path.
    assert.equal((await processJob(pendingJob)).isOk(), true);
    const memberFiles = (await database.db.select().from(files)).filter(
      (file) => file.uploaderId === "other",
    );
    assert.equal(memberFiles.length, 1);
    assert.equal(memberFiles[0]!.status, "pending");
    assert.match(memberFiles[0]!.path, /^_inbox\//);
    const batchId = "de8000cc-434e-4023-8d91-650c69a544a6";
    const nested = await createAndQueue(
      "Textures/a.txt",
      Buffer.from("a"),
      "other",
      { batchId },
    );
    const sibling = await createAndQueue(
      "Textures/b.txt",
      Buffer.from("b"),
      "other",
      { batchId },
    );
    assert.equal((await processJob(nested)).isOk(), true);
    assert.equal((await processJob(sibling)).isOk(), true);
    const batchFiles = (await database.db.select().from(files)).filter((file) =>
      file.path.includes(batchId),
    );
    assert.equal(batchFiles.length, 2);
    assert.equal(batchFiles[0]!.folderId, batchFiles[1]!.folderId);
    assert.equal(
      batchFiles.every(
        (file) => file.status === "pending" && file.path.includes("/textures/"),
      ),
      true,
    );

    // A small real PAK exercises analysis, owned extraction and staged-byte retention.
    const pak = Buffer.alloc(12 + 5 + 64);
    pak.write("PACK");
    pak.writeUInt32LE(17, 4);
    pak.writeUInt32LE(64, 8);
    pak.write("proof", 12);
    pak.write("proof.txt", 17);
    pak.writeUInt32LE(12, 17 + 56);
    pak.writeUInt32LE(5, 17 + 60);
    const archiveJob = await createAndQueue("bundle.pak", pak, "owner", {
      purpose: "archive",
    });
    const archiveId = JSON.parse(archiveJob.input).uploadId;
    const extractUrl = routes.api.extractUpload.href({ uploadId: archiveId });
    const destination = JSON.stringify({
      folderName: "Bundle",
      folderSlug: "bundle",
      parentFolderId: "dest",
    });
    assert.equal(
      (
        await send(
          extractUrl,
          "POST",
          { "Content-Type": "application/json" },
          destination,
        )
      ).status,
      409,
    );
    assert.equal((await processJob(archiveJob)).isOk(), true);
    const analyzed = (await database.db.select().from(jobs)).find(
      (job) => job.id === archiveJob.id,
    )!;
    assert.equal(JSON.parse(analyzed.output!).archiveAnalysis.totalFiles, 1);
    await cleanupTusUploads();
    assert.equal(
      (await getTusServer().datastore.getUpload(archiveId)).size,
      pak.length,
    );
    assert.equal(
      (
        await send(
          extractUrl,
          "POST",
          {
            Cookie: "artbin_session=other",
            "Content-Type": "application/json",
          },
          destination,
        )
      ).status,
      403,
    );
    await database.db
      .update(users)
      .set({ isAdmin: true })
      .where(eq(users.id, "other"));
    assert.equal(
      (
        await send(
          extractUrl,
          "POST",
          {
            Cookie: "artbin_session=other",
            "Content-Type": "application/json",
          },
          destination,
        )
      ).status,
      404,
    );
    await database.db
      .update(users)
      .set({ isAdmin: false })
      .where(eq(users.id, "other"));
    assert.equal(
      (
        await send(
          extractUrl,
          "POST",
          { "Content-Type": "application/json" },
          destination,
        )
      ).status,
      202,
    );
    assert.equal(
      (
        await send(
          extractUrl,
          "POST",
          { "Content-Type": "application/json" },
          destination,
        )
      ).status,
      202,
    );
    const extraction = (await database.db.select().from(jobs)).find(
      (job) => job.id === `upload-extract-${archiveId}`,
    )!;
    await cleanupTusUploads();
    assert.equal(
      (await getTusServer().datastore.getUpload(archiveId)).size,
      pak.length,
    );
    assert.equal((await processJob(extraction)).isOk(), true);
    assert.equal(
      await readFile(
        join(runtime, "public/uploads/destination/bundle/proof.txt"),
        "utf8",
      ),
      "proof",
    );
    await cleanupTusUploads();
    let removed = false;
    try {
      await getTusServer().datastore.getUpload(archiveId);
    } catch {
      removed = true;
    }
    assert.equal(removed, true);
    const archiveMetadata = Object.entries({
      purpose: "archive",
      path: "bundle.pak",
      sha256: createHash("sha256").update(pak).digest("hex"),
    })
      .map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`)
      .join(",");
    assert.equal(
      (
        await send(routes.api.uploads.href(), "POST", {
          Cookie: "artbin_session=other",
          "Upload-Length": String(pak.length),
          "Upload-Metadata": archiveMetadata,
        })
      ).status,
      403,
    );
    await database.db.insert(folders).values({
      id: "maps",
      name: "Maps",
      slug: "destination/maps",
      parentId: "dest",
    });
    const bspJob = await createAndQueue(
      "maps/dm_test.bsp",
      await readFile("__tests__/fixtures/dm_barraco2.bsp"),
    );
    assert.equal((await processJob(bspJob)).isOk(), true);
    // This Quake BSP has no supplied palette; don't schedule an impossible extraction.
    const extract = (await database.db.select().from(jobs)).find(
      (job) => job.type === "extract-bsp",
    );
    assert.equal(extract, undefined);
    const invalid = encoded.replace(
      Buffer.from(metadata.path).toString("base64"),
      Buffer.from("../escape.txt").toString("base64"),
    );
    assert.equal(
      (
        await send(routes.api.uploads.href(), "POST", {
          "Upload-Length": "1",
          "Upload-Metadata": invalid,
        })
      ).status,
      400,
    );
    assert.equal(
      (await send(routes.api.uploads.href(), "POST", { "Upload-Length": "1" }))
        .status,
      400,
    );
  } finally {
    database.close();
    await rm(runtime, { recursive: true, force: true });
  }
});
