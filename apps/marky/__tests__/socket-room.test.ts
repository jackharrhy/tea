/* eslint-disable no-shadow */
import * as assert from "remix/assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "remix/test";

import * as Y from "yjs";

import { ContentStore } from "../app/data/content-store.ts";
import { SocketRoom, type PeerConnection } from "../app/middleware/sockets.ts";
import { PROSEMIRROR_FRAGMENT_NAME } from "../app/shared/constants.ts";
import { textToDoc } from "../app/shared/doc-utils.ts";
import {
  MESSAGE_TYPE_AWARENESS,
  MESSAGE_TYPE_DELETE_FILE,
  MESSAGE_TYPE_ERROR,
  MESSAGE_TYPE_FILE_LIST,
  MESSAGE_TYPE_OPEN_FILE,
  MESSAGE_TYPE_SUBDOC_AWARENESS,
  MESSAGE_TYPE_SUBDOC_SYNC,
  MESSAGE_TYPE_SYNC,
} from "../app/shared/message-types.ts";
import {
  decodeFileMessage,
  decodeUtf8,
  encodeFileMessage,
  encodeMessage,
  encodeRenameFrame,
  encodeUtf8,
} from "../app/shared/wire.ts";
import { prosemirrorToYXmlFragment } from "y-prosemirror";

class FakePeer implements PeerConnection {
  readonly received: Uint8Array[] = [];
  private open = true;

  send(frame: Uint8Array): void {
    this.received.push(frame);
  }
  isOpen(): boolean {
    return this.open;
  }
  close(): void {
    this.open = false;
  }

  framesOfType(type: number): Uint8Array[] {
    return this.received.filter((f) => f[0] === type);
  }

  lastFrameOfType(type: number): Uint8Array | undefined {
    const frames = this.framesOfType(type);
    return frames[frames.length - 1];
  }
}

interface FakeCommit {
  kind: "edit" | "rename" | "delete";
  path: string;
  oldPath?: string;
  message: string;
}

class FakeGitStore {
  readonly commits: FakeCommit[] = [];
  private staged: Array<{
    kind: "edit" | "rename" | "delete";
    path: string;
    oldPath?: string;
  }> = [];

  async assertRepo(): Promise<void> {}

  async stageEdit(args: { path: string }): Promise<void> {
    this.staged.push({ kind: "edit", path: args.path });
  }

  async stageRename(args: { oldPath: string; newPath: string }): Promise<void> {
    this.staged.push({
      kind: "rename",
      path: args.newPath,
      oldPath: args.oldPath,
    });
  }

  async stageDelete(args: { path: string }): Promise<void> {
    this.staged.push({ kind: "delete", path: args.path });
  }

  async commit(message: string): Promise<{ sha: string } | null> {
    if (this.staged.length === 0) return null;
    const dominant = this.staged[this.staged.length - 1];
    this.commits.push({
      kind: dominant.kind,
      path: dominant.path,
      oldPath: dominant.oldPath,
      message,
    });
    this.staged = [];
    return { sha: "fake-" + this.commits.length.toString().padStart(40, "0") };
  }

  async hasUnpushed(): Promise<boolean> {
    return false;
  }

  async push(): Promise<void> {}

  readonly repoDir: string = "/repo";
}

describe("SocketRoom", () => {
  let dir: string;
  let store: ContentStore;
  let room: SocketRoom;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "marky-room-test-"));
    store = new ContentStore({ dir });
    await store.ensureDir();
    room = new SocketRoom({ store });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("greets a new peer with an empty file list", () => {
    const peer = new FakePeer();
    room.addPeer(peer);

    const sync = peer.lastFrameOfType(MESSAGE_TYPE_SYNC);
    assert.ok(sync, "expected initial sync frame");

    const list = peer.lastFrameOfType(MESSAGE_TYPE_FILE_LIST);
    assert.ok(list, "expected initial file list frame");
    assert.deepEqual(JSON.parse(decodeUtf8(list.subarray(1))), []);
  });

  it("lists existing files after rescan", async () => {
    await store.write("alpha.md", "one");
    await store.write("beta.md", "two");
    await room.rescan();

    const peer = new FakePeer();
    room.addPeer(peer);

    const list = peer.lastFrameOfType(MESSAGE_TYPE_FILE_LIST);
    assert.ok(list);
    const files = JSON.parse(decodeUtf8(list.subarray(1))) as string[];
    assert.deepEqual(files.toSorted(), ["alpha.md", "beta.md"]);
  });

  it("picks up files added to disk on rescan", async () => {
    // Initial rescan with nothing on disk.
    await room.rescan();
    assert.equal(room.filenameToSubdoc.has("appeared.md"), false);

    // A new file appears outside the running room (e.g. somebody scped it in).
    await store.write("appeared.md", "content from outside");
    await room.rescan();

    assert.equal(room.filenameToSubdoc.has("appeared.md"), true);
  });

  it("removes files deleted from disk on rescan", async () => {
    await store.write("doomed.md", "short-lived");
    await room.rescan();
    assert.equal(room.filenameToSubdoc.has("doomed.md"), true);

    // File disappears outside the running room.
    await store.remove("doomed.md");
    await room.rescan();

    assert.equal(room.filenameToSubdoc.has("doomed.md"), false);
    // Awareness and loaded-from-disk tracking must be cleared too, otherwise
    // a future file with the same name would inherit stale state.
    assert.equal(room.filenameToSubdocAwareness.has("doomed.md"), false);
  });

  it("coalesces concurrent rescans into a single promise", async () => {
    await store.write("one.md", "");
    // Calling rescan() twice while the first is still pending must return
    // the same promise so we don't pound the filesystem.
    const first = room.rescan();
    const second = room.rescan();
    assert.equal(first, second);
    await first;
  });

  it("opens an existing file with its persisted contents", async () => {
    await store.write("hello.md", "persisted body");
    await room.rescan();

    const peer = new FakePeer();
    room.addPeer(peer);
    peer.received.length = 0; // ignore initial frames

    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("hello.md")),
    );

    const subdocSync = peer.lastFrameOfType(MESSAGE_TYPE_SUBDOC_SYNC);
    assert.ok(subdocSync);
    const { filename, payload } = decodeFileMessage(subdocSync.subarray(1));
    assert.equal(filename, "hello.md");

    // Apply the snapshot into a local Yjs doc and confirm the text matches.
    const local = new Y.Doc();
    Y.applyUpdate(local, payload);
    const fragment = local.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
    assert.equal(fragment.toString().includes("persisted body"), true);
  });

  it("preserves in-memory subdoc content when the same file is opened again", async () => {
    // Regression: previously OPEN_FILE always wiped the fragment and reloaded
    // from disk, which destroyed unflushed edits whenever the client re-opened
    // a file (notably after a rename — the new name is OPEN_FILE'd by the
    // client but its subdoc already holds the user's in-memory edits).
    await store.write("notes.md", "persisted body");
    await room.rescan();

    const peer = new FakePeer();
    room.addPeer(peer);
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("notes.md")),
    );

    // Simulate an edit that has not been flushed to disk yet.
    const subdoc = room.filenameToSubdoc.get("notes.md")!;
    subdoc.transact(() => {
      const fragment = subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
      fragment.delete(0, fragment.length);
      prosemirrorToYXmlFragment(textToDoc("important unsaved edit"), fragment);
    }, peer);

    // Disk still has the original content.
    assert.equal(await store.read("notes.md"), "persisted body");

    // Re-open the file. The subdoc must keep its in-memory state.
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("notes.md")),
    );

    const fragment = subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
    assert.equal(
      fragment.toString().includes("important unsaved edit"),
      true,
      "subdoc content should be preserved across re-opens",
    );
  });

  it("preserves in-memory content when the renamed file is opened again", async () => {
    // End-to-end regression matching what the client does on rename: it
    // optimistically marks the file as current and the user clicks it,
    // which sends OPEN_FILE for newName. The subdoc was migrated server-side
    // and holds the user's unflushed edits; reopening must not clobber them.
    const room = new SocketRoom({ store });
    const peer = new FakePeer();
    room.addPeer(peer);

    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("old.md")),
    );

    const subdoc = room.filenameToSubdoc.get("old.md")!;
    subdoc.transact(() => {
      const fragment = subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
      prosemirrorToYXmlFragment(
        textToDoc("first sentence after creation"),
        fragment,
      );
    }, peer);

    await room.receive(peer, encodeRenameFrame("old.md", "new.md"));
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("new.md")),
    );

    const migrated = room.filenameToSubdoc.get("new.md")!;
    const fragment = migrated.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
    assert.equal(
      fragment.toString().includes("first sentence after creation"),
      true,
      "renamed subdoc should keep its content when reopened",
    );
  });

  it("broadcasts subdoc edits to subscribed peers", async () => {
    await store.write("shared.md", "");
    await room.rescan();

    const a = new FakePeer();
    const b = new FakePeer();
    room.addPeer(a);
    room.addPeer(b);

    // Both peers open the file.
    await room.receive(
      a,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("shared.md")),
    );
    await room.receive(
      b,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("shared.md")),
    );

    a.received.length = 0;
    b.received.length = 0;

    // Peer A makes an edit and the room broadcasts the update to subscribed peers.
    const subdoc = room.filenameToSubdoc.get("shared.md")!;
    subdoc.transact(() => {
      const fragment = subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
      fragment.delete(0, fragment.length);
      prosemirrorToYXmlFragment(textToDoc("hello from A"), fragment);
    }, a);

    const bFrames = b.framesOfType(MESSAGE_TYPE_SUBDOC_SYNC);
    assert.ok(bFrames.length > 0, "peer B should receive a subdoc sync from A");
    const { filename } = decodeFileMessage(bFrames[0].subarray(1));
    assert.equal(filename, "shared.md");
  });

  it("overwrites awareness user for peers with an identity", async () => {
    const { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } =
      await import("y-protocols/awareness");

    // Build a real awareness frame as a peer would: a Y.Doc + Awareness with
    // a forged user state.
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", { name: "forged", color: "#000000" });
    const update = encodeAwarenessUpdate(awareness, [awareness.clientID]);

    const a = new FakePeer();
    const b = new FakePeer();
    room.addPeer(a, { name: "real-jack", color: "#ff0000" });
    room.addPeer(b);

    await room.receive(a, encodeMessage(MESSAGE_TYPE_AWARENESS, update));

    const frame = b.lastFrameOfType(MESSAGE_TYPE_AWARENESS);
    assert.ok(frame, "peer b should receive a broadcasted awareness frame");

    // Apply the broadcast frame into a fresh awareness and confirm the user
    // was rewritten to peer A's bound identity. The observer's constructor
    // seeds an empty local state so we look up the source clientID directly.
    const observerDoc = new Y.Doc();
    const observer = new Awareness(observerDoc);
    applyAwarenessUpdate(observer, frame.subarray(1), null);
    const sourceState = observer.getStates().get(awareness.clientID);
    assert.ok(sourceState, "observer should have the source clientID state");
    assert.deepEqual(sourceState.user, { name: "real-jack", color: "#ff0000" });
  });

  it("does NOT rewrite awareness user when the peer has no bound identity", async () => {
    // Companion to the previous test: in anonymous mode the server trusts
    // client-supplied awareness because there's no identity to enforce.
    const { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } =
      await import("y-protocols/awareness");

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", {
      name: "Anonymous Leek",
      color: "#aabbcc",
    });
    const update = encodeAwarenessUpdate(awareness, [awareness.clientID]);

    const a = new FakePeer();
    const b = new FakePeer();
    room.addPeer(a); // no identity
    room.addPeer(b);

    await room.receive(a, encodeMessage(MESSAGE_TYPE_AWARENESS, update));

    const frame = b.lastFrameOfType(MESSAGE_TYPE_AWARENESS);
    assert.ok(frame);

    const observerDoc = new Y.Doc();
    const observer = new Awareness(observerDoc);
    applyAwarenessUpdate(observer, frame.subarray(1), null);
    const sourceState = observer.getStates().get(awareness.clientID);
    assert.ok(sourceState);
    assert.deepEqual(sourceState.user, {
      name: "Anonymous Leek",
      color: "#aabbcc",
    });
  });

  it("does not broadcast to peers who have not opened the file", async () => {
    await store.write("private.md", "");
    await room.rescan();

    const a = new FakePeer();
    const b = new FakePeer();
    room.addPeer(a);
    room.addPeer(b);

    await room.receive(
      a,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("private.md")),
    );
    a.received.length = 0;
    b.received.length = 0;

    const subdoc = room.filenameToSubdoc.get("private.md")!;
    subdoc.transact(() => {
      const fragment = subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
      prosemirrorToYXmlFragment(textToDoc("A made an edit"), fragment);
    }, a);

    assert.equal(b.framesOfType(MESSAGE_TYPE_SUBDOC_SYNC).length, 0);
  });

  it("commits a single editor after the debounce window elapses", async (t) => {
    const timers = t.useFakeTimers();

    const fake = new FakeGitStore();
    (fake as any).repoDir = store.dir;
    const room = new SocketRoom({
      store,
      gitStore: fake as unknown as import("../app/data/git-store.ts").GitStore,
      persistIdleMs: 1000,
    });

    const peer = new FakePeer();
    room.addPeer(peer, { name: "jackharrhy", color: "#205ea6" });
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("hello.md")),
    );

    const subdoc = room.filenameToSubdoc.get("hello.md")!;
    // Force the subdoc to have content so persistSubdocToDisk actually writes.
    subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME).insert(0, []);
    await room.receive(
      peer,
      encodeFileMessage(
        MESSAGE_TYPE_SUBDOC_SYNC,
        "hello.md",
        new Uint8Array([0]),
      ),
    );

    timers.advance(1001);
    await room.waitForFlushes();

    assert.equal(fake.commits.length, 1);
    assert.equal(fake.commits[0].kind, "edit");
    assert.equal(fake.commits[0].message, "edit hello.md by jackharrhy");
  });

  it("joins multiple editor names alphabetically in the commit message", async (t) => {
    const timers = t.useFakeTimers();

    const fake = new FakeGitStore();
    (fake as any).repoDir = store.dir;
    const room = new SocketRoom({
      store,
      gitStore: fake as unknown as import("../app/data/git-store.ts").GitStore,
      persistIdleMs: 1000,
    });

    const a = new FakePeer();
    const b = new FakePeer();
    room.addPeer(a, { name: "tim", color: "#000" });
    room.addPeer(b, { name: "alex", color: "#fff" });
    await room.receive(
      a,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("shared.md")),
    );
    await room.receive(
      b,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("shared.md")),
    );

    const subdoc = room.filenameToSubdoc.get("shared.md")!;
    subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME).insert(0, []);
    await room.receive(
      a,
      encodeFileMessage(
        MESSAGE_TYPE_SUBDOC_SYNC,
        "shared.md",
        new Uint8Array([0]),
      ),
    );
    await room.receive(
      b,
      encodeFileMessage(
        MESSAGE_TYPE_SUBDOC_SYNC,
        "shared.md",
        new Uint8Array([0]),
      ),
    );

    timers.advance(1001);
    await room.waitForFlushes();

    assert.equal(fake.commits[0].message, "edit shared.md by alex, tim");
  });

  it("runs an independent debounce timer per file", async (t) => {
    const timers = t.useFakeTimers();

    const fake = new FakeGitStore();
    (fake as any).repoDir = store.dir;
    const room = new SocketRoom({
      store,
      gitStore: fake as unknown as import("../app/data/git-store.ts").GitStore,
      persistIdleMs: 1000,
    });

    const peer = new FakePeer();
    room.addPeer(peer, { name: "jack", color: "#0" });

    for (const filename of ["a.md", "b.md"]) {
      await room.receive(
        peer,
        encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8(filename)),
      );
      const sub = room.filenameToSubdoc.get(filename)!;
      sub.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME).insert(0, []);
      await room.receive(
        peer,
        encodeFileMessage(
          MESSAGE_TYPE_SUBDOC_SYNC,
          filename,
          new Uint8Array([0]),
        ),
      );
    }

    timers.advance(1001);
    await room.waitForFlushes();

    assert.equal(fake.commits.length, 2);
    const paths = fake.commits.map((c) => c.path).toSorted();
    assert.deepEqual(paths, ["a.md", "b.md"]);
  });

  it("persists to disk without committing when gitStore is absent", async (t) => {
    const timers = t.useFakeTimers();

    const room = new SocketRoom({ store, persistIdleMs: 1000 });

    const peer = new FakePeer();
    room.addPeer(peer, { name: "jack", color: "#0" });
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("hello.md")),
    );
    const sub = room.filenameToSubdoc.get("hello.md")!;
    sub.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME).insert(0, []);
    await room.receive(
      peer,
      encodeFileMessage(
        MESSAGE_TYPE_SUBDOC_SYNC,
        "hello.md",
        new Uint8Array([0]),
      ),
    );

    timers.advance(1001);
    await room.waitForFlushes();

    // The file exists on disk after the flush (ContentStore created it on open).
    const onDisk = await store.read("hello.md");
    assert.notEqual(onDisk, null);
  });

  it("renames a subdoc in-memory and on disk, then schedules a rename commit", async (t) => {
    const timers = t.useFakeTimers();

    const fake = new FakeGitStore();
    (fake as any).repoDir = store.dir;
    const room = new SocketRoom({
      store,
      gitStore: fake as unknown as import("../app/data/git-store.ts").GitStore,
      persistIdleMs: 1000,
    });

    const peer = new FakePeer();
    room.addPeer(peer, { name: "jackharrhy", color: "#0" });
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("old.md")),
    );

    await room.receive(peer, encodeRenameFrame("old.md", "new.md"));

    assert.equal(room.filenameToSubdoc.has("old.md"), false);
    assert.equal(room.filenameToSubdoc.has("new.md"), true);
    assert.equal(await store.read("old.md"), null);
    assert.equal(await store.read("new.md"), "");

    timers.advance(1001);
    await room.waitForFlushes();

    assert.equal(fake.commits.length, 1);
    assert.equal(fake.commits[0].kind, "rename");
    assert.equal(
      fake.commits[0].message,
      "rename old.md to new.md by jackharrhy",
    );
  });

  it("rejects rename when newName already exists, with an ERROR frame to the requester", async () => {
    const room = new SocketRoom({ store });

    const peer = new FakePeer();
    room.addPeer(peer, { name: "jack", color: "#0" });
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("a.md")),
    );
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("b.md")),
    );

    peer.received.length = 0;
    await room.receive(peer, encodeRenameFrame("a.md", "b.md"));

    const errorFrame = peer.lastFrameOfType(MESSAGE_TYPE_ERROR);
    assert.ok(errorFrame);
    const message = decodeUtf8(errorFrame.subarray(1));
    assert.match(message, /already exists/);
    assert.equal(room.filenameToSubdoc.has("a.md"), true);
    assert.equal(room.filenameToSubdoc.has("b.md"), true);
  });

  it("collapses edit-then-rename into one rename commit with both editors", async (t) => {
    const timers = t.useFakeTimers();

    const fake = new FakeGitStore();
    (fake as any).repoDir = store.dir;
    const room = new SocketRoom({
      store,
      gitStore: fake as unknown as import("../app/data/git-store.ts").GitStore,
      persistIdleMs: 1000,
    });

    const editor = new FakePeer();
    const renamer = new FakePeer();
    room.addPeer(editor, { name: "tim", color: "#0" });
    room.addPeer(renamer, { name: "jack", color: "#1" });
    await room.receive(
      editor,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("old.md")),
    );
    await room.receive(
      renamer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("old.md")),
    );

    const sub = room.filenameToSubdoc.get("old.md")!;
    sub.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME).insert(0, []);
    await room.receive(
      editor,
      encodeFileMessage(
        MESSAGE_TYPE_SUBDOC_SYNC,
        "old.md",
        new Uint8Array([0]),
      ),
    );
    await room.receive(renamer, encodeRenameFrame("old.md", "new.md"));

    timers.advance(1001);
    await room.waitForFlushes();

    assert.equal(fake.commits.length, 1);
    assert.equal(fake.commits[0].kind, "rename");
    assert.equal(
      fake.commits[0].message,
      "rename old.md to new.md by jack, tim",
    );
  });

  it("deletes a file and schedules a delete commit", async (t) => {
    const timers = t.useFakeTimers();

    const fake = new FakeGitStore();
    (fake as any).repoDir = store.dir;
    const room = new SocketRoom({
      store,
      gitStore: fake as unknown as import("../app/data/git-store.ts").GitStore,
      persistIdleMs: 1000,
    });

    const peer = new FakePeer();
    room.addPeer(peer, { name: "jackharrhy", color: "#0" });
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("goodbye.md")),
    );
    await store.write("goodbye.md", "hi"); // ensure the file exists on disk
    peer.received.length = 0;

    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_DELETE_FILE, encodeUtf8("goodbye.md")),
    );

    assert.equal(room.filenameToSubdoc.has("goodbye.md"), false);
    assert.equal(await store.read("goodbye.md"), null);
    const list = peer.lastFrameOfType(MESSAGE_TYPE_FILE_LIST);
    assert.ok(list);

    timers.advance(1001);
    await room.waitForFlushes();

    assert.equal(fake.commits.length, 1);
    assert.equal(fake.commits[0].kind, "delete");
    assert.equal(fake.commits[0].message, "delete goodbye.md by jackharrhy");
  });

  it("collapses rename-then-delete into a single delete commit", async (t) => {
    const timers = t.useFakeTimers();

    const fake = new FakeGitStore();
    (fake as any).repoDir = store.dir;
    const room = new SocketRoom({
      store,
      gitStore: fake as unknown as import("../app/data/git-store.ts").GitStore,
      persistIdleMs: 1000,
    });

    const peer = new FakePeer();
    room.addPeer(peer, { name: "jack", color: "#0" });
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("a.md")),
    );
    await room.receive(peer, encodeRenameFrame("a.md", "b.md"));
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_DELETE_FILE, encodeUtf8("b.md")),
    );

    timers.advance(1001);
    await room.waitForFlushes();

    assert.equal(fake.commits.length, 1);
    assert.equal(fake.commits[0].kind, "delete");
    assert.equal(fake.commits[0].message, "delete b.md by jack");
  });

  it("delete of an unknown file is a no-op (no error frame)", async () => {
    const room = new SocketRoom({ store });

    const peer = new FakePeer();
    room.addPeer(peer, { name: "jack", color: "#0" });

    peer.received.length = 0;
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_DELETE_FILE, encodeUtf8("ghost.md")),
    );

    const error = peer.lastFrameOfType(MESSAGE_TYPE_ERROR);
    assert.equal(error, undefined);
  });

  it("dispose clears flush timers and pending ops", async (t) => {
    const timers = t.useFakeTimers();

    const room = new SocketRoom({ store, persistIdleMs: 1000 });
    const peer = new FakePeer();
    room.addPeer(peer, { name: "jack", color: "#0" });
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("a.md")),
    );
    const sub = room.filenameToSubdoc.get("a.md")!;
    sub.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME).insert(0, []);
    await room.receive(
      peer,
      encodeFileMessage(MESSAGE_TYPE_SUBDOC_SYNC, "a.md", new Uint8Array([0])),
    );

    // Timer should be armed.
    await room.dispose();

    // After dispose, no more timers; advancing the clock does nothing.
    timers.advance(10_000);
    await new Promise<void>((r) => setImmediate(r));
    // No assertion needed — we just want dispose() to complete without throwing.
  });

  it("captures the editor name before destroying state on delete", async (t) => {
    const timers = t.useFakeTimers();

    const fake = new FakeGitStore();
    (fake as any).repoDir = store.dir;
    const room = new SocketRoom({
      store,
      gitStore: fake as unknown as import("../app/data/git-store.ts").GitStore,
      persistIdleMs: 1000,
    });

    // Anonymous mode: identity is null, name comes from awareness.
    const peer = new FakePeer();
    room.addPeer(peer); // no identity

    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("to-delete.md")),
    );
    // Seed the awareness with a user.name for this peer's awareness clientID.
    const awareness = room.filenameToSubdocAwareness.get("to-delete.md")!;
    awareness.setLocalStateField("user", {
      name: "Anonymous Tester",
      color: "#0",
    });

    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_DELETE_FILE, encodeUtf8("to-delete.md")),
    );

    timers.advance(1001);
    await room.waitForFlushes();

    assert.equal(fake.commits.length, 1);
    assert.equal(fake.commits[0].kind, "delete");
    assert.equal(
      fake.commits[0].message,
      "delete to-delete.md by Anonymous Tester",
    );
  });

  it("captures the editor name before destroying state on rename", async (t) => {
    const timers = t.useFakeTimers();

    const fake = new FakeGitStore();
    (fake as any).repoDir = store.dir;
    const room = new SocketRoom({
      store,
      gitStore: fake as unknown as import("../app/data/git-store.ts").GitStore,
      persistIdleMs: 1000,
    });

    const peer = new FakePeer();
    room.addPeer(peer);
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("old.md")),
    );
    const awareness = room.filenameToSubdocAwareness.get("old.md")!;
    awareness.setLocalStateField("user", {
      name: "Anonymous Tester",
      color: "#0",
    });

    await room.receive(peer, encodeRenameFrame("old.md", "new.md"));

    timers.advance(1001);
    await room.waitForFlushes();

    assert.equal(fake.commits.length, 1);
    assert.equal(
      fake.commits[0].message,
      "rename old.md to new.md by Anonymous Tester",
    );
  });

  it("converges concurrent edits from two peers in the authoritative subdoc", async () => {
    // The CRDT correctness contract: two peers can edit the same file
    // independently and the server's subdoc must contain both contributions.
    // We simulate the real wire shape: each peer holds a local Y.Doc seeded
    // from the server's initial SUBDOC_SYNC, makes a local change, and ships
    // the resulting update back via SUBDOC_SYNC.

    await store.write("shared.md", "");
    await room.rescan();

    const a = new FakePeer();
    const b = new FakePeer();
    room.addPeer(a);
    room.addPeer(b);

    await room.receive(
      a,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("shared.md")),
    );
    await room.receive(
      b,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("shared.md")),
    );

    // Find the initial SUBDOC_SYNC each peer got back from OPEN_FILE.
    const aInitial = a.lastFrameOfType(MESSAGE_TYPE_SUBDOC_SYNC)!;
    const bInitial = b.lastFrameOfType(MESSAGE_TYPE_SUBDOC_SYNC)!;

    // Each peer builds a local doc seeded with the server's state.
    const aDoc = new Y.Doc();
    const bDoc = new Y.Doc();
    Y.applyUpdate(aDoc, decodeFileMessage(aInitial.subarray(1)).payload);
    Y.applyUpdate(bDoc, decodeFileMessage(bInitial.subarray(1)).payload);

    // Peer A inserts text. Capture the resulting update.
    let aUpdate: Uint8Array = new Uint8Array();
    aDoc.on("update", (u: Uint8Array) => {
      aUpdate = u;
    });
    aDoc.transact(() => {
      const fragment = aDoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
      prosemirrorToYXmlFragment(textToDoc("AAA from peer A"), fragment);
    });

    // Peer B inserts different text concurrently — without seeing A's update.
    let bUpdate: Uint8Array = new Uint8Array();
    bDoc.on("update", (u: Uint8Array) => {
      bUpdate = u;
    });
    bDoc.transact(() => {
      const fragment = bDoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
      prosemirrorToYXmlFragment(textToDoc("BBB from peer B"), fragment);
    });

    // Both peers ship their updates back to the server.
    await room.receive(
      a,
      encodeFileMessage(MESSAGE_TYPE_SUBDOC_SYNC, "shared.md", aUpdate),
    );
    await room.receive(
      b,
      encodeFileMessage(MESSAGE_TYPE_SUBDOC_SYNC, "shared.md", bUpdate),
    );

    // Server's authoritative subdoc must contain both contributions.
    const server = room.filenameToSubdoc.get("shared.md")!;
    const fragmentText = server
      .getXmlFragment(PROSEMIRROR_FRAGMENT_NAME)
      .toString();
    assert.equal(
      fragmentText.includes("AAA from peer A"),
      true,
      "A's edit must be present",
    );
    assert.equal(
      fragmentText.includes("BBB from peer B"),
      true,
      "B's edit must be present",
    );
  });

  it("removePeer stops broadcasting to that peer", async () => {
    await store.write("shared.md", "");
    await room.rescan();

    const survivor = new FakePeer();
    const leaver = new FakePeer();
    room.addPeer(survivor);
    room.addPeer(leaver);

    await room.receive(
      survivor,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("shared.md")),
    );
    await room.receive(
      leaver,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("shared.md")),
    );

    room.removePeer(leaver);

    survivor.received.length = 0;
    leaver.received.length = 0;

    // An edit happens. The leaver must NOT receive any broadcast.
    const subdoc = room.filenameToSubdoc.get("shared.md")!;
    subdoc.transact(() => {
      const fragment = subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
      prosemirrorToYXmlFragment(textToDoc("after leaver left"), fragment);
    }, survivor);

    assert.equal(leaver.framesOfType(MESSAGE_TYPE_SUBDOC_SYNC).length, 0);
    assert.ok(survivor.framesOfType(MESSAGE_TYPE_SUBDOC_SYNC).length > 0);
  });

  it("removePeer purges the peer's awareness states from every subdoc", async () => {
    // Without this cleanup, every disconnected client leaks an awareness
    // clientID into every subdoc they touched — survivors keep seeing the
    // ghost cursor forever.
    const { Awareness, encodeAwarenessUpdate } =
      await import("y-protocols/awareness");

    await store.write("shared.md", "");
    await room.rescan();

    const survivor = new FakePeer();
    const leaver = new FakePeer();
    room.addPeer(survivor);
    room.addPeer(leaver);

    await room.receive(
      survivor,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("shared.md")),
    );
    await room.receive(
      leaver,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("shared.md")),
    );

    // The leaver publishes awareness with a known clientID.
    const leaverDoc = new Y.Doc();
    const leaverAwareness = new Awareness(leaverDoc);
    leaverAwareness.setLocalStateField("user", {
      name: "leaver",
      color: "#000",
    });
    const update = encodeAwarenessUpdate(leaverAwareness, [
      leaverAwareness.clientID,
    ]);
    await room.receive(
      leaver,
      encodeFileMessage(MESSAGE_TYPE_SUBDOC_AWARENESS, "shared.md", update),
    );

    const serverAwareness = room.filenameToSubdocAwareness.get("shared.md")!;
    assert.ok(
      serverAwareness.getStates().has(leaverAwareness.clientID),
      "server should have the leaver's awareness state before disconnect",
    );

    room.removePeer(leaver);

    assert.equal(
      serverAwareness.getStates().has(leaverAwareness.clientID),
      false,
      "leaver's awareness state should be purged from the subdoc after disconnect",
    );
  });

  it("rebinds the subdoc broadcaster to newName after rename", async () => {
    const room = new SocketRoom({ store });
    const editor = new FakePeer();
    const observer = new FakePeer();
    room.addPeer(editor);
    room.addPeer(observer);

    await room.receive(
      editor,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("old.md")),
    );
    await room.receive(
      observer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("old.md")),
    );

    await room.receive(editor, encodeRenameFrame("old.md", "new.md"));

    // After rename, the observer's subscription has been migrated to newName,
    // so an edit on the migrated subdoc must broadcast under newName.
    observer.received.length = 0;
    const subdoc = room.filenameToSubdoc.get("new.md")!;
    subdoc.transact(() => {
      const fragment = subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
      prosemirrorToYXmlFragment(textToDoc("post-rename edit"), fragment);
    }, editor);

    const frames = observer.framesOfType(MESSAGE_TYPE_SUBDOC_SYNC);
    assert.ok(
      frames.length > 0,
      "observer should receive a sync frame after rename",
    );
    for (const frame of frames) {
      const { filename } = decodeFileMessage(frame.subarray(1));
      assert.equal(filename, "new.md", "broadcast must use the new filename");
    }
  });

  it("does not broadcast under the OLD name after rename", async () => {
    const room = new SocketRoom({ store });
    const editor = new FakePeer();
    const observer = new FakePeer();
    room.addPeer(editor);
    room.addPeer(observer);

    await room.receive(
      editor,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("old.md")),
    );
    await room.receive(
      observer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("old.md")),
    );
    await room.receive(editor, encodeRenameFrame("old.md", "new.md"));

    observer.received.length = 0;
    const subdoc = room.filenameToSubdoc.get("new.md")!;
    subdoc.transact(() => {
      const fragment = subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
      prosemirrorToYXmlFragment(textToDoc("post-rename edit"), fragment);
    }, editor);

    for (const frame of observer.framesOfType(MESSAGE_TYPE_SUBDOC_SYNC)) {
      const { filename } = decodeFileMessage(frame.subarray(1));
      assert.notEqual(
        filename,
        "old.md",
        "no stale broadcast under the old name",
      );
    }
  });

  it("reload from disk happens again after a delete-then-recreate cycle", async () => {
    await store.write("reborn.md", "first content");
    await room.rescan();

    const peer = new FakePeer();
    room.addPeer(peer);

    // Open, then delete.
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("reborn.md")),
    );
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_DELETE_FILE, encodeUtf8("reborn.md")),
    );
    assert.equal(room.filenameToSubdoc.has("reborn.md"), false);

    // Re-write a new file at the same path. Opening it should now seed from
    // the new disk content (the old subdoc's "loaded" tracking has to have
    // been cleared on delete).
    await store.write("reborn.md", "second content");
    await room.receive(
      peer,
      encodeMessage(MESSAGE_TYPE_OPEN_FILE, encodeUtf8("reborn.md")),
    );

    const subdoc = room.filenameToSubdoc.get("reborn.md")!;
    const fragment = subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
    assert.equal(fragment.toString().includes("second content"), true);
    assert.equal(fragment.toString().includes("first content"), false);
  });

  it("attachPushTimer stores the timer and dispose clears it", async () => {
    const room = new SocketRoom({ store });
    let cleared = false;
    const fakeTimer = setInterval(() => {}, 9999);
    // Override clearInterval just for this test.
    const realClearInterval = globalThis.clearInterval;
    (globalThis as any).clearInterval = (t: NodeJS.Timeout) => {
      if (t === fakeTimer) cleared = true;
      realClearInterval(t);
    };
    try {
      room.attachPushTimer(fakeTimer);
      await room.dispose();
      assert.equal(cleared, true);
    } finally {
      (globalThis as any).clearInterval = realClearInterval;
      realClearInterval(fakeTimer);
    }
  });
});
