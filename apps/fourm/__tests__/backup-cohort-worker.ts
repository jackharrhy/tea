import { CommunityCell } from "../app/data/community-cell.ts";
import { runtime } from "../app/runtime.ts";
import type { Bindings } from "../app/runtime.ts";
import {
  captureBackupSnapshot,
  readBackupSnapshot,
} from "../app/backup-snapshot.ts";
import type { BackupSnapshot } from "../app/backup-snapshot.ts";
import { CommunityError } from "../app/data/community.ts";
export { CommunityCell };
type FixtureBindings = Bindings & {
  FIXTURE_KEY: string;
  FIXTURE_ACTOR_ID: string;
};
let cached: BackupSnapshot | null = null;
async function snapshot(env: FixtureBindings) {
  if (!cached) {
    const store = runtime(env),
      status = await store.call("backupStatus", Number(env.FIXTURE_ACTOR_ID));
    if (!status.backups.length) throw new Error("No fixture snapshot");
    cached = await readBackupSnapshot(
      env.MEDIA,
      String(status.backups[0].name),
    );
    if (!cached) throw new Error("Fixture snapshot missing");
  }
  return cached;
}
async function digest(bytes: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export default {
  async fetch(request: Request, env: FixtureBindings) {
    const url = new URL(request.url),
      path = url.pathname;
    if (path === "/health") return new Response("isolated fixture");
    if (request.headers.get("Authorization") !== `Bearer ${env.FIXTURE_KEY}`)
      return new Response(null, { status: 401 });
    try {
      const store = runtime(env),
        actor = Number(env.FIXTURE_ACTOR_ID);
      if (path === "/seed")
        return Response.json(await store.call("restore", await request.json()));
      if (path.startsWith("/objects/")) {
        const key = decodeURIComponent(path.slice("/objects/".length));
        if (
          key.startsWith(".") ||
          key.split("/").some((p) => !p || p === "." || p === "..")
        )
          throw new Error("Unsafe fixture path");
        const bytes = await request.arrayBuffer();
        if ((await digest(bytes)) !== request.headers.get("X-Content-SHA256"))
          throw new Error("Fixture upload checksum mismatch");
        await env.MEDIA.put(key, bytes, {
          onlyIf: { etagDoesNotMatch: "*" },
          httpMetadata: {
            contentType:
              request.headers.get("Content-Type") ?? "application/octet-stream",
          },
          customMetadata: JSON.parse(
            request.headers.get("X-Fixture-Metadata") ?? "{}",
          ),
        });
        return new Response(null, { status: 204 });
      }
      if (path === "/capture") {
        const job = await store.call("beginBackup", actor);
        const result = await captureBackupSnapshot(
          env.MEDIA,
          String(job.name),
          () => store.call("exportArchive", actor),
        );
        const receipt = await store.call(
          "completeBackup",
          String(job.name),
          result.dbSize,
          result.files,
        );
        return Response.json({
          name: job.name,
          state: receipt.state,
          files: result.files,
          tables: Object.keys(result.snapshot.tables).length,
        });
      }
      if (path === "/manifest") return Response.json(await snapshot(env));
      if (path === "/drop-live") {
        const data = await snapshot(env);
        for (const object of data.objects)
          await env.MEDIA.delete(object.storage_path);
        return Response.json({ removed: data.objects.length });
      }
      if (path === "/live-status") {
        const data = await snapshot(env);
        let missing = 0;
        for (const object of data.objects)
          if (!(await env.MEDIA.head(object.storage_path))) missing++;
        return Response.json({ missing });
      }
      if (path.startsWith("/restore-object/")) {
        const data = await snapshot(env),
          index = Number(path.slice("/restore-object/".length));
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= data.objects.length
        )
          throw new Error("Invalid fixture object index");
        const item = data.objects[index],
          object = await env.MEDIA.get(".backups/" + item.file);
        if (!object) throw new Error("Fixture backup object missing");
        const bytes = await object.arrayBuffer();
        if (
          bytes.byteLength !== item.size_bytes ||
          (await digest(bytes)) !== item.sha256
        )
          throw new Error("Fixture backup bytes corrupt");
        await env.MEDIA.put(item.storage_path, bytes, {
          onlyIf: { etagDoesNotMatch: "*" },
          httpMetadata: { contentType: item.content_type },
          customMetadata: {
            fourm_etag: item.etag,
            fourm_last_modified: item.last_modified,
            ...(item.mtime_ns ? { fourm_mtime_ns: item.mtime_ns } : {}),
          },
        });
        return new Response(null, { status: 204 });
      }
      if (path === "/restore-tables") {
        const data = await snapshot(env),
          target = env.COMMUNITIES.get(
            env.COMMUNITIES.idFromName("backup-restored-cohort"),
          );
        const result = await target.call("restore", [
          data.tables,
          await digest(
            new TextEncoder().encode(JSON.stringify(data.tables)).buffer,
          ),
        ]);
        if (!result.ok) throw new CommunityError(result.status, result.error);
        return Response.json(result.value);
      }
      if (path === "/readback") {
        const target = env.COMMUNITIES.get(
          env.COMMUNITIES.idFromName("backup-restored-cohort"),
        );
        const result = await target.call("exportArchive", [actor]);
        if (!result.ok) throw new CommunityError(result.status, result.error);
        return Response.json(result.value);
      }
      if (path.startsWith("/restored-object/")) {
        const data = await snapshot(env),
          index = Number(path.slice("/restored-object/".length)),
          item = data.objects[index];
        if (!item) throw new Error("Invalid fixture object index");
        const object = await env.MEDIA.get(item.storage_path);
        if (!object) throw new Error("Restored fixture object missing");
        return new Response(object.body, {
          headers: {
            "Content-Type":
              object.httpMetadata?.contentType ?? "application/octet-stream",
            ETag: object.customMetadata?.fourm_etag ?? object.httpEtag,
            "Last-Modified":
              object.customMetadata?.fourm_last_modified ??
              object.uploaded.toUTCString(),
            "X-Fixture-Mtime-Ns": object.customMetadata?.fourm_mtime_ns ?? "",
          },
        });
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Fixture failed" },
        { status: error instanceof CommunityError ? error.status : 500 },
      );
    }
  },
};
