import { cleanupOrphanMedia } from "../app/storage-health.ts";
import { uploadMedia } from "../app/media.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { createCommunity } from "../app/data/community.ts";
import {
  processMediaMove,
  cleanupMediaTransfer,
  cleanupAccountMedia,
} from "../app/media-move.ts";
import { chosenFilename } from "../app/media-filename.ts";

function fixture(persistent = false) {
  const directory = persistent
    ? mkdtempSync(join(tmpdir(), "fourm-media-move-"))
    : null;
  const filename = directory
    ? join(directory, "authority.sqlite3")
    : ":memory:";
  let sqlite = new DatabaseSync(filename);
  sqlite.exec("PRAGMA foreign_keys=ON");
  function open() {
    return createCommunity({
      all(sql, ...values) {
        if (!values.length && sql.includes(";")) {
          sqlite.exec(sql);
          return [];
        }
        const stmt = sqlite.prepare(sql);
        return stmt.columns().length
          ? stmt.all(...values)
          : (stmt.run(...values), []);
      },
      transaction(fn) {
        sqlite.exec("BEGIN");
        try {
          const result = fn();
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    });
  }
  const community = open();
  community.restore({
    users: [
      {
        id: 41,
        username: "jane",
        display_name: "Jane",
        password_hash: "",
        is_admin: 1,
      },
      { id: 72, username: "sam", display_name: "Sam", password_hash: "" },
    ],
    external_identities: [
      {
        issuer: "https://fixture.invalid",
        subject: "fixture-jane",
        user_id: 41,
      },
    ],
    media: [
      {
        id: 11,
        user_id: 41,
        storage_path: "jane/song.mp3",
        mime_type: "audio/mpeg",
        size_bytes: 6,
        alt_text: "original",
      },
      {
        id: 12,
        user_id: 41,
        storage_path: "jane/photo.png",
        mime_type: "image/png",
        size_bytes: 6,
      },
      {
        id: 13,
        user_id: 72,
        storage_path: "sam/song.mp3",
        mime_type: "audio/mpeg",
        size_bytes: 6,
      },
    ],
    pages: [
      {
        id: 14,
        user_id: 41,
        slug: "music",
        title: "Music",
        content: '<audio src="/uploads/jane/song.mp3"></audio>',
      },
    ],
  });
  const objects = new Map(
    ["jane/song.mp3", "jane/photo.png", "sam/song.mp3"].map((path) => [
      path,
      {
        bytes: new TextEncoder().encode("sample"),
        size: 6,
        uploaded: new Date("2026-11-01T00:00:00Z"),
        customMetadata: {},
        httpMetadata: { contentType: "application/octet-stream" },
      },
    ]),
  );
  let failedPut = false,
    failedDelete = false,
    failAfterPut = false,
    failAfterDelete = false,
    puts = 0;
  const media = {
    async head(path) {
      return objects.get(path) ?? null;
    },
    async get(path) {
      const item = objects.get(path);
      if (!item) return null;
      const response = new Response(item.bytes);
      return {
        ...item,
        body: response.body,
        arrayBuffer: () => response.arrayBuffer(),
      };
    },
    async put(path, body, options) {
      if (objects.has(path)) return null;
      expect(options.onlyIf.etagDoesNotMatch).toBe("*");
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const object = {
        bytes,
        size: bytes.length,
        uploaded: new Date(),
        customMetadata: options.customMetadata,
        httpMetadata: options.httpMetadata,
      };
      objects.set(path, object);
      puts++;
      if (failAfterPut && !failedPut) {
        failedPut = true;
        throw Error("connection lost after object commit");
      }
      return object;
    },
    async delete(path) {
      objects.delete(path);
      if (failAfterDelete && !failedDelete) {
        failedDelete = true;
        throw Error("connection lost after delete");
      }
    },
  };
  return {
    community,
    get sqlite() {
      return sqlite;
    },
    reopen() {
      if (!directory) throw new Error("A persistent fixture is required");
      sqlite.close();
      sqlite = new DatabaseSync(filename);
      sqlite.exec("PRAGMA foreign_keys=ON");
      return open();
    },
    close() {
      sqlite.close();
      if (directory) rmSync(directory, { recursive: true });
    },
    open,
    media,
    objects,
    puts: () => puts,
    failPut: () => {
      failAfterPut = true;
    },
    failDelete: () => {
      failAfterDelete = true;
    },
  };
}

test("source filename choices retain extensions and reserve collisions before upload", () => {
  expect(chosenFilename(" my song.wav ", "take.MP3")).toBe("my-song.mp3");
  expect(chosenFilename("", "../../odd name!.PNG")).toBe("odd-name.png");
  const f = fixture();
  expect(
    f.community.reserveNamedUpload(41, "song.mp3", "audio/mpeg", 6)
      .storage_path,
  ).toBe("jane/song-2.mp3");
  expect(
    f.community.reserveNamedUpload(41, "song.mp3", "audio/mpeg", 6)
      .storage_path,
  ).toBe("jane/song-3.mp3");
  expect(() => f.community.beginUsernameRename(41, "new-jane")).toThrow(
    "uploads or deletions",
  );
  f.close();
});

test("rename is owner-only, commits after copies, and keeps IDs, alt text and saved HTML", async () => {
  const f = fixture();
  expect(() => f.community.beginMediaRename(72, 11, "track")).toThrow(
    "Media not found",
  );
  expect(() => f.community.beginMediaRename(41, 13, "track")).toThrow(
    "Media not found",
  );
  const move = f.community.beginMediaRename(41, 11, "track");
  expect(() => f.community.commitMediaMove(move.id)).toThrow(
    "copies are not complete",
  );
  expect(() => f.community.deleteMedia(41, 11)).toThrow("still finishing");
  expect(() =>
    f.community.reserveNamedUpload(41, "new.mp3", "audio/mpeg", 6),
  ).toThrow("still finishing");
  await processMediaMove(f.community, f.media, move.id);
  expect(f.community.mediaItem(41, 11)).toMatchObject({
    id: 11,
    storage_path: "jane/track.mp3",
    alt_text: "original",
  });
  expect(f.objects.has("jane/song.mp3")).toBe(false);
  expect(f.objects.get("jane/track.mp3").bytes).toEqual(
    new TextEncoder().encode("sample"),
  );
  expect(
    f.sqlite.prepare("SELECT content FROM pages WHERE id=14").get().content,
  ).toContain("/uploads/jane/song.mp3");
  expect(f.community.pendingMediaMoves()).toEqual([]);
  expect(f.sqlite.prepare("pragma foreign_key_check").all()).toEqual([]);
  f.close();
});

test("an uncertain R2 write resumes without copying twice after reconstruction", async () => {
  const f = fixture(true);
  const move = f.community.beginUsernameRename(41, "new-jane");
  f.failPut();
  await expect(processMediaMove(f.community, f.media, move.id)).rejects.toThrow(
    "connection lost",
  );
  expect(
    f.community.resolveIdentity("https://fixture.invalid", "fixture-jane")
      .username,
  ).toBe("jane");
  expect(f.community.mediaItem(41, 11).storage_path).toBe("jane/song.mp3");
  const recovered = f.reopen();
  await processMediaMove(recovered, f.media, move.id);
  expect(f.puts()).toBe(2);
  expect(
    recovered.resolveIdentity("https://fixture.invalid", "fixture-jane"),
  ).toMatchObject({ id: 41, username: "new-jane" });
  expect(recovered.mediaItem(41, 11)).toMatchObject({
    id: 11,
    storage_path: "new-jane/song.mp3",
    alt_text: "original",
  });
  expect(recovered.mediaItem(72, 13).storage_path).toBe("sam/song.mp3");
  expect(f.objects.has("sam/song.mp3")).toBe(true);
  expect(
    f.objects.get("new-jane/song.mp3").customMetadata.fourm_last_modified,
  ).toBe("2026-11-01T00:00:00.000Z");
  f.close();
});

test("post-commit cleanup resumes without restoring old metadata or releasing paths early", async () => {
  const f = fixture(true);
  const move = f.community.beginUsernameRename(41, "new-jane");
  f.failDelete();
  await expect(processMediaMove(f.community, f.media, move.id)).rejects.toThrow(
    "connection lost",
  );
  expect(f.community.pendingMediaMoves()[0].state).toBe("cleanup");
  expect(
    f.community.resolveIdentity("https://fixture.invalid", "fixture-jane")
      .username,
  ).toBe("new-jane");
  expect(() => f.community.deleteMedia(41, 11)).toThrow("still finishing");
  const recovered = f.reopen();
  expect(recovered.beginUsernameRename(41, "new-jane").id).toBe(move.id);
  await processMediaMove(recovered, f.media, move.id);
  await processMediaMove(recovered, f.media, move.id);
  expect(recovered.pendingMediaMoves()).toEqual([]);
  expect(f.objects.has("jane/photo.png")).toBe(false);
  expect(recovered.mediaItem(41, 12).storage_path).toBe("new-jane/photo.png");
  f.close();
});

test("unrelated destination bytes are never overwritten and pending usernames cannot be enrolled", async () => {
  const f = fixture();
  const move = f.community.beginUsernameRename(41, "new-jane");
  f.objects.set("new-jane/song.mp3", {
    size: 6,
    customMetadata: {},
    bytes: new TextEncoder().encode("unique"),
  });

  expect(f.objects.get("new-jane/song.mp3").bytes).toEqual(
    new TextEncoder().encode("unique"),
  );
  expect(f.objects.has("jane/song.mp3")).toBe(true);
  f.community.createInvite(72, "review-invite", 2);
  f.community.reserveEnrollment("review-invite", "review-request", null);
  expect(() =>
    f.community.claimEnrollment(
      "review-request",
      "https://fixture.invalid",
      "new-subject",
      "new-jane",
      "Review",
    ),
  ).toThrow("already belongs");
  await processMediaMove(f.community, f.media, move.id);
  expect(f.community.mediaItem(41, 11).storage_path).toBe(
    "new-jane/song-2.mp3",
  );
  expect(f.objects.get("new-jane/song.mp3").bytes).toEqual(
    new TextEncoder().encode("unique"),
  );
  f.close();
});

test("cleanup claims an expired upload before external deletion so a late upload cannot publish missing bytes", () => {
  const f = fixture();
  const reservation = f.community.reserveNamedUpload(
    41,
    "late.png",
    "image/png",
    6,
  );
  const path = reservation.storage_path;
  f.sqlite
    .prepare("UPDATE media_transfers SET expires_at=0 WHERE storage_path=?")
    .run(path);
  expect(f.community.pendingMediaDeletes()).toEqual([
    { storage_path: path, upload_id: reservation.upload_id },
  ]);
  expect(() => f.community.finishUpload(41, path)).toThrow(
    "no longer reserved",
  );
  expect(
    f.community.reserveNamedUpload(41, "late.png", "image/png", 6).storage_path,
  ).toBe("jane/late-2.png");
  f.close();
});

test("expired upload cleanup cannot delete an unrelated unindexed object", async () => {
  const f = fixture();
  const reservation = f.community.reserveNamedUpload(
    41,
    "unindexed.png",
    "image/png",
    6,
  );
  f.objects.set(reservation.storage_path, {
    size: 6,
    bytes: new TextEncoder().encode("unique"),
    customMetadata: {},
  });
  f.sqlite
    .prepare("UPDATE media_transfers SET expires_at=0 WHERE storage_path=?")
    .run(reservation.storage_path);
  const transfer = f.community.pendingMediaDeletes()[0];
  await cleanupMediaTransfer(f.community, f.media, transfer);
  expect(f.objects.get(reservation.storage_path).bytes).toEqual(
    new TextEncoder().encode("unique"),
  );
  expect(f.community.hasMediaTransfers()).toBe(false);
  f.close();
});

test("uncertain upload cleanup deletes only the object bearing its persisted upload marker", async () => {
  const f = fixture(true);
  const reservation = f.community.reserveNamedUpload(
    41,
    "abandoned.png",
    "image/png",
    6,
  );
  f.objects.set(reservation.storage_path, {
    size: 6,
    bytes: new TextEncoder().encode("sample"),
    customMetadata: { fourm_upload: reservation.upload_id },
  });
  f.community.abandonUpload(41, reservation.storage_path);
  f.failDelete();
  await expect(
    cleanupMediaTransfer(
      f.community,
      f.media,
      f.community.pendingMediaDeletes()[0],
    ),
  ).rejects.toThrow("connection lost");
  const recovered = f.reopen();
  await cleanupMediaTransfer(
    recovered,
    f.media,
    recovered.pendingMediaDeletes()[0],
  );
  expect(f.objects.has(reservation.storage_path)).toBe(false);
  expect(recovered.hasMediaTransfers()).toBe(false);
  f.close();
});

for (const staleHead of [false, true]) {
  test(`upload preserves an unindexed collision${staleHead ? " appearing between HEAD and PUT" : ""}`, async () => {
    const f = fixture();
    f.objects.set("jane/fixture.png", {
      size: 6,
      bytes: new TextEncoder().encode("unique"),
      customMetadata: {},
    });
    const originalHead = f.media.head;
    if (staleHead)
      f.media.head = async (path) =>
        path === "jane/fixture.png" ? null : originalHead(path);
    const form = new FormData();
    form.set(
      "file",
      new File(["sample"], "fixture.PNG", { type: "image/png" }),
    );
    const store = {
      call: async (method, ...args) => f.community[method](...args),
    };
    const item = await uploadMedia(
      new Request("https://fixture.invalid/settings/media/upload", {
        method: "POST",
        body: form,
      }),
      { MEDIA: f.media },
      store,
      { id: 41, username: "jane" },
    );
    expect(item.storage_path).toBe("jane/fixture-2.png");
    expect(f.objects.get("jane/fixture.png").bytes).toEqual(
      new TextEncoder().encode("unique"),
    );
    expect(
      f.objects.get(item.storage_path).customMetadata.fourm_upload,
    ).toMatch(/^[a-f0-9-]{36}$/);
    expect(f.community.hasMediaTransfers()).toBe(false);
    f.close();
  });
}

test("admin rename retains disabled member identity, timestamp and media through recovery", async () => {
  const f = fixture(true);
  try {
    f.sqlite
      .prepare("UPDATE users SET updated_at='2020-01-02 03:04:05' WHERE id=72")
      .run();
    const original = f.community.profile("sam");
    expect(() =>
      f.community.beginAdminUsernameRename(72, 41, "new-jane", ""),
    ).toThrow("Admin access required");
    f.sqlite.prepare("UPDATE users SET is_disabled=1 WHERE id=72").run();
    expect(() =>
      f.community.beginAdminUsernameRename(72, 41, "new-jane", ""),
    ).toThrow("Membership is unavailable");
    expect(() => f.community.beginUsernameRename(72, "new-sam")).toThrow(
      "Membership is unavailable",
    );
    expect(() =>
      f.community.beginAdminUsernameRename(41, 72, "bad name", "Do not save"),
    ).toThrow("username must");
    expect(f.community.profile("sam").display_name).toBe(original.display_name);
    const move = f.community.beginAdminUsernameRename(
      41,
      72,
      " NEW-SAM ",
      " Updated name ",
    );
    expect(move.preserve_updated_at).toBe(1);
    f.failPut();
    await expect(
      processMediaMove(f.community, f.media, Number(move.id)),
    ).rejects.toThrow("connection lost");
    const recovered = f.reopen();
    expect(recovered.beginAdminUsernameRename(41, 72, "new-sam", "").id).toBe(
      move.id,
    );
    await processMediaMove(recovered, f.media, Number(move.id));
    expect(recovered.profile("new-sam")).toMatchObject({
      id: 72,
      display_name: "Updated name",
      updated_at: original.updated_at,
    });
    expect(
      f.sqlite.prepare("SELECT is_disabled FROM users WHERE id=72").get()
        .is_disabled,
    ).toBe(1);
    expect(f.objects.has("sam/song.mp3")).toBe(false);
    expect(f.objects.has("new-sam/song.mp3")).toBe(true);
    expect(
      f.sqlite.prepare("SELECT storage_path FROM media WHERE id=13").get()
        .storage_path,
    ).toBe("new-sam/song.mp3");
    expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    f.close();
  }
});

test("an existing pending move upgrades its operational schema and resumes", async () => {
  const f = fixture();
  try {
    const move = f.community.beginUsernameRename(41, "legacy-jane");
    f.sqlite.exec("ALTER TABLE media_moves DROP COLUMN preserve_updated_at");
    const upgraded = f.open();
    const pending = upgraded.pendingMediaMoves()[0];
    expect(pending.id).toBe(move.id);
    expect(pending.preserve_updated_at).toBe(0);
    await processMediaMove(upgraded, f.media, Number(move.id));
    expect(upgraded.profile("legacy-jane").id).toBe(41);
    expect(f.objects.has("legacy-jane/song.mp3")).toBe(true);
    expect(upgraded.pendingMediaMoves()).toEqual([]);
  } finally {
    f.close();
  }
});

test("account object cleanup survives lost acknowledgment and holds names until removal finishes", async () => {
  const f = fixture(true);
  try {
    expect(f.community.beginAccountDelete(41, 72, "reparent")).toBe(1);
    expect(f.community.hasAccountCleanup()).toBe(true);
    expect(f.objects.has("sam/song.mp3")).toBe(true);
    expect(() => f.community.beginUsernameRename(41, "sam")).toThrow(
      "already taken",
    );
    expect(() =>
      f.community.assertArchiveRestoreAuthority(
        "https://fixture.invalid",
        "fixture-jane",
      ),
    ).toThrow("cleanup must finish");
    f.failDelete();
    await expect(cleanupAccountMedia(f.community, f.media)).rejects.toThrow(
      "connection lost",
    );
    expect(f.community.hasAccountCleanup()).toBe(true);
    const recovered = f.reopen();
    await cleanupAccountMedia(recovered, f.media);
    expect(recovered.hasAccountCleanup()).toBe(false);
    expect(f.objects.has("sam/song.mp3")).toBe(false);
    expect(f.objects.has("jane/song.mp3")).toBe(true);
    expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(recovered.beginUsernameRename(41, "sam")).not.toBe(null);
  } finally {
    f.close();
  }
});

test("orphan cleanup reserves paths across lost deletion acknowledgment and authority reopen", async () => {
  const f = fixture(true);
  try {
    expect(() =>
      f.community.beginOrphanCleanup(null, "jane/orphan.txt"),
    ).toThrow("Admin access required");
    expect(() => f.community.beginOrphanCleanup(72, "jane/orphan.txt")).toThrow(
      "Admin access required",
    );
    expect(() => f.community.beginOrphanCleanup(41, "jane/.hidden")).toThrow(
      "Invalid member media path",
    );
    expect(f.community.beginOrphanCleanup(41, "jane/song.mp3")).toBe(false);
    f.community.reserveUpload(41, "jane/upload.txt", "text/plain", 3);
    expect(f.community.beginOrphanCleanup(41, "jane/upload.txt")).toBe(false);
    const move = f.community.beginMediaRename(72, 13, "renamed.mp3");
    expect(f.community.beginOrphanCleanup(41, "sam/renamed.mp3")).toBe(false);
    expect(f.community.beginOrphanCleanup(41, "sam/song.mp3")).toBe(false);
    expect(f.community.beginOrphanCleanup(41, "jane/orphan.txt")).toBe(true);
    expect(f.community.beginOrphanCleanup(41, "jane/orphan.txt")).toBe(false);
    expect(() => f.community.reserveArchiveObject("jane/orphan.txt")).toThrow(
      "reserved for orphan cleanup",
    );
    f.community.reserveArchiveObject("jane/staged.txt");
    expect(f.community.beginOrphanCleanup(41, "jane/staged.txt")).toBe(false);
    f.objects.set("jane/orphan.txt", {
      bytes: new Uint8Array([1, 2, 3]),
      size: 3,
    });
    const reserved = f.community.reserveNamedUpload(
      41,
      "orphan.txt",
      "text/plain",
      3,
    );
    expect(reserved.storage_path).not.toBe("jane/orphan.txt");
    expect(() =>
      f.community.reserveUpload(41, "jane/orphan.txt", "text/plain", 3),
    ).toThrow("reserved for orphan cleanup");
    expect(() => f.community.restore({})).toThrow("Orphan cleanup must finish");
    f.failDelete();
    await expect(cleanupOrphanMedia(f.community, f.media)).rejects.toThrow(
      "connection lost",
    );
    expect(f.community.hasOrphanCleanup()).toBe(true);
    const reopened = f.reopen();
    expect(reopened.hasOrphanCleanup()).toBe(true);
    expect(await cleanupOrphanMedia(reopened, f.media)).toBe(1);
    expect(reopened.hasOrphanCleanup()).toBe(false);
    expect(f.objects.has("jane/orphan.txt")).toBe(false);
    expect(f.objects.has("jane/song.mp3")).toBe(true);
    expect(f.objects.has("sam/song.mp3")).toBe(true);
    expect(reopened.pendingMediaMoves()[0].id).toBe(move.id);
    expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    f.close();
  }
});

test("missing-record cleanup rechecks exact identity, path and transfer reservations", () => {
  const f = fixture();
  try {
    expect(() => f.community.adminMediaRecords(72)).toThrow(
      "Admin access required",
    );
    expect(
      f.community.removeMissingMediaRecord(41, 11, "jane/not-the-same-path"),
    ).toBe(false);
    f.community.beginMediaRename(41, 11, "new.mp3");
    expect(f.community.removeMissingMediaRecord(41, 11, "jane/song.mp3")).toBe(
      false,
    );
    expect(f.community.removeMissingMediaRecord(41, 13, "sam/song.mp3")).toBe(
      true,
    );
    expect(f.community.removeMissingMediaRecord(41, 13, "sam/song.mp3")).toBe(
      false,
    );
    expect(f.community.adminMediaRecords(41)).toHaveLength(2);
    expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    f.close();
  }
});
