import { expect, it } from "vitest";
import {
  captureBackupSnapshot,
  readBackupSnapshot,
  canonicalTables,
} from "../app/backup-snapshot.ts";
import { coreTables } from "../app/data/schema.ts";
import type { Row } from "../app/data/community.ts";
function fixture() {
  const tables: Record<string, Row[]> = Object.fromEntries(
    coreTables.map((table) => [table, []]),
  );
  tables.users = [{ id: 41, username: "fixture", password_hash: "" }];
  tables.media = [
    {
      id: 1,
      user_id: 41,
      storage_path: "fixture/photo.png",
      mime_type: "image/png",
      size_bytes: 3,
    },
  ];
  const objects = new Map<
    string,
    { bytes: Uint8Array; customMetadata: Record<string, string> }
  >();
  objects.set("fixture/photo.png", {
    bytes: new Uint8Array([1, 2, 3]),
    customMetadata: {
      fourm_etag: '"original"',
      fourm_last_modified: "Wed, 01 Jan 2025 00:00:00 GMT",
      fourm_mtime_ns: "1735689600000000000",
    },
  });
  let loseManifestAck = false;
  const info = (key: string) => {
    const value = objects.get(key);
    return value
      ? {
          key,
          size: value.bytes.length,
          etag: Array.from(value.bytes).join("-"),
          httpEtag: '"native"',
          uploaded: new Date(0),
          customMetadata: value.customMetadata,
        }
      : null;
  };
  const bucket = {
    async head(key: string) {
      return info(key) as R2Object | null;
    },
    async get(key: string) {
      const value = objects.get(key);
      return value
        ? ({
            ...info(key),
            arrayBuffer: async () => value.bytes.slice().buffer,
          } as R2ObjectBody)
        : null;
    },
    async put(key: string, body: ArrayBuffer, options: R2PutOptions) {
      if (objects.has(key)) return null;
      objects.set(key, {
        bytes: new Uint8Array(body).slice(),
        customMetadata: options.customMetadata ?? {},
      });
      if (loseManifestAck && key.startsWith(".backups/manifests/")) {
        loseManifestAck = false;
        throw Error("Manifest acknowledgment lost");
      }
      return info(key) as R2Object;
    },
  } as Pick<R2Bucket, "get" | "head" | "put">;
  return {
    tables,
    objects,
    bucket,
    loseManifestAck: () => {
      loseManifestAck = true;
    },
    readTables: async () => structuredClone(tables),
  };
}
it("stores verified immutable media and metadata, preserving source validators and retry identity", async () => {
  const f = fixture();
  f.loseManifestAck();
  await expect(
    captureBackupSnapshot(f.bucket, "pending-one", f.readTables),
  ).rejects.toThrow("acknowledgment lost");
  f.tables.users[0].username = "changed-after-snapshot";
  const captured = await captureBackupSnapshot(
    f.bucket,
    "pending-one",
    f.readTables,
  );
  expect(captured.files).toBe(1);
  expect(captured.snapshot.tables.users[0].username).toBe("fixture");
  expect(captured.snapshot.objects[0]).toMatchObject({
    etag: '"original"',
    last_modified: "Wed, 01 Jan 2025 00:00:00 GMT",
    mtime_ns: "1735689600000000000",
    size_bytes: 3,
    content_type: "image/png",
  });
  expect(captured.snapshot.objects[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  f.objects.delete("fixture/photo.png");
  expect(await readBackupSnapshot(f.bucket, "pending-one")).toEqual(
    captured.snapshot,
  );
  expect(f.objects.size).toBe(2);
});
it("never publishes a manifest after metadata or media changes during capture", async () => {
  const f = fixture();
  let reads = 0;
  await expect(
    captureBackupSnapshot(f.bucket, "changed", async () => {
      if (reads++) f.tables.users[0].username = "changed";
      return f.readTables();
    }),
  ).rejects.toThrow("Community changed");
  expect(f.objects.has(".backups/manifests/changed.json")).toBe(false);
  const g = fixture();
  await expect(
    captureBackupSnapshot(g.bucket, "missing", async () => {
      g.objects.delete("fixture/photo.png");
      return g.readTables();
    }),
  ).rejects.toThrow("Media changed");
  expect(g.objects.has(".backups/manifests/missing.json")).toBe(false);
});
it("rejects corrupt manifests and object bytes rather than repairing immutable evidence", async () => {
  const f = fixture();
  const saved = await captureBackupSnapshot(f.bucket, "corrupt", f.readTables);
  const key = ".backups/" + saved.snapshot.objects[0].file;
  f.objects.get(key)!.bytes = new Uint8Array([9, 9, 9]);
  await expect(readBackupSnapshot(f.bucket, "corrupt")).rejects.toThrow(
    "object verification failed",
  );
  const g = fixture();
  await captureBackupSnapshot(g.bucket, "manifest", g.readTables);
  g.objects.get(".backups/manifests/manifest.json")!.bytes =
    new TextEncoder().encode("{}");
  await expect(readBackupSnapshot(g.bucket, "manifest")).rejects.toThrow(
    "manifest checksum mismatch",
  );
});
it("compares logical rows independent of query ordering and rejects incomplete capture inventories", async () => {
  const first = {
    users: [
      { id: 1, name: "one" },
      { name: "two", id: 2 },
    ],
  };
  expect(canonicalTables(first)).toBe(
    canonicalTables({
      users: [
        { id: 2, name: "two" },
        { name: "one", id: 1 },
      ],
    }),
  );
  const f = fixture();
  delete f.tables.invites;
  await expect(
    captureBackupSnapshot(f.bucket, "incomplete", f.readTables),
  ).rejects.toThrow("Incomplete backup tables");
});
