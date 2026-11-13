import { readNativeBackup, restoreNativeBackup } from "../app/native-backup.ts";
import type { NativeBackup } from "../app/native-backup.ts";
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
let cachedNative: NativeBackup | null = null;
async function nativeSnapshot(env: FixtureBindings) {
  if (!cachedNative) {
    const status = await runtime(env).call(
      "backupStatus",
      Number(env.FIXTURE_ACTOR_ID),
    );
    cachedNative = await readNativeBackup(
      env.MEDIA,
      String(status.backups[0].name),
    );
    if (!cachedNative) throw new Error("Native fixture snapshot missing");
  }
  return cachedNative;
}
async function files(env: FixtureBindings, native: boolean) {
  if (!native) return (await snapshot(env)).objects;
  return (await nativeSnapshot(env)).files.map((file) => ({
    storage_path: file.key,
    sha256: file.sha256,
    size_bytes: file.size,
    file: `objects/${file.sha256}`,
    mime_type: file.httpMetadata.contentType ?? "application/octet-stream",
    content_type: file.httpMetadata.contentType ?? "application/octet-stream",
    etag: file.customMetadata.fourm_etag ?? file.httpEtag,
    last_modified:
      file.customMetadata.fourm_last_modified ??
      new Date(file.uploaded).toUTCString(),
    mtime_ns: file.customMetadata.fourm_mtime_ns,
  }));
}
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
      if (path === "/full/scheduled-status")
        return Response.json(await store.call("backupStatus", actor));
      if (path === "/full/source-state")
        return Response.json(await store.call("exportRecovery", actor));
      if (path === "/full/capture") {
        const cell = env.COMMUNITIES.get(
          env.COMMUNITIES.idFromName("fourm-community-v1"),
        );
        const result = await cell.runBackup(actor);
        if (!result.ok) throw new CommunityError(result.status, result.error);
        const capturedNative = await nativeSnapshot(env);
        return Response.json({
          name: result.result.name,
          state: result.result.state,
          files: result.result.file_count,
          tables: Object.keys(capturedNative.recovery.tables).length,
          pruned: result.result.pruned,
          objectsRemoved: result.result.objects_removed,
        });
      }
      if (path === "/full/manifest")
        return Response.json(await nativeSnapshot(env));
      if (path === "/full/drop-live") {
        const data = await nativeSnapshot(env);
        for (const file of data.files) await env.MEDIA.delete(file.key);
        return Response.json({ removed: data.files.length });
      }
      if (path === "/full/live-status") {
        const data = await nativeSnapshot(env);
        let missing = 0;
        for (const file of data.files)
          if (!(await env.MEDIA.head(file.key))) missing++;
        return Response.json({ missing });
      }
      if (path === "/full/restore") {
        const data = await nativeSnapshot(env),
          target = env.COMMUNITIES.get(
            env.COMMUNITIES.idFromName("backup-restored-cohort"),
          );
        return Response.json(
          await restoreNativeBackup(env.MEDIA, data.name, async (state) => {
            const result = await target.call("restoreRecovery", [state]);
            if (!result.ok)
              throw new CommunityError(result.status, result.error);
            return result.value;
          }),
        );
      }
      if (path === "/full/readback") {
        const target = env.COMMUNITIES.get(
          env.COMMUNITIES.idFromName("backup-restored-cohort"),
        );
        const result = await target.call("exportRecovery", [actor]);
        if (!result.ok) throw new CommunityError(result.status, result.error);
        return Response.json(result.value);
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
        const inventory = await files(
            env,
            url.searchParams.get("format") === "native",
          ),
          index = Number(path.slice("/restored-object/".length)),
          item = inventory[index];
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
