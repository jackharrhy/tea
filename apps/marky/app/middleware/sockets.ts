import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  modifyAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from "y-prosemirror";
import * as Y from "yjs";

import type { ContentStore } from "../data/content-store.ts";
import type { GitStore } from "../data/git-store.ts";
import { PROSEMIRROR_FRAGMENT_NAME } from "../shared/constants.ts";
import { docToText, plainTextSchema, textToDoc } from "../shared/doc-utils.ts";
import {
  MESSAGE_TYPE_AWARENESS,
  MESSAGE_TYPE_DELETE_FILE,
  MESSAGE_TYPE_ERROR,
  MESSAGE_TYPE_FILE_LIST,
  MESSAGE_TYPE_OPEN_FILE,
  MESSAGE_TYPE_RENAME_FILE,
  MESSAGE_TYPE_SUBDOC_AWARENESS,
  MESSAGE_TYPE_SUBDOC_SYNC,
  MESSAGE_TYPE_SYNC,
} from "../shared/message-types.ts";
import {
  decodeFileMessage,
  decodeRenameFrame,
  decodeUtf8,
  encodeFileMessage,
  encodeMessage,
  encodeUtf8,
} from "../shared/wire.ts";

// A connection that the protocol can write frames to. This abstraction lets
// us swap uWebSockets for an in-memory test transport.
export interface PeerConnection {
  send(frame: Uint8Array): void;
  isOpen(): boolean;
}

export interface SocketsOptions {
  store: ContentStore;
  gitStore?: GitStore;
  persistIdleMs?: number;
}

// Identity bound to a peer when it upgrades through an authenticated session.
// `SocketRoom` rewrites awareness updates from these peers so the broadcasted
// `user` field always reflects the server-trusted identity.
export interface PeerIdentity {
  name: string;
  color: string;
}

interface PeerState {
  subscriptions: Set<string>;
  identity?: PeerIdentity;
  // Awareness clientIDs this peer has published, per filename. We track these
  // so we can purge stale states from each subdoc's Awareness when the peer
  // disconnects — otherwise survivors keep seeing the leaver's cursor.
  awarenessClientIds: Map<string, Set<number>>;
}

type PendingOpKind = "edit" | "rename" | "delete";

interface PendingOp {
  kind: PendingOpKind;
  editors: Set<string>;
  oldName?: string;
}

// `SocketRoom` owns the shared Yjs doc tree, file list, awareness, and the
// per-peer subscription bookkeeping. It is transport-agnostic. `attachSockets`
// is a thin wrapper that binds it to uWebSockets.
export class SocketRoom {
  readonly store: ContentStore;
  readonly gitStore?: GitStore;
  private readonly persistIdleMs: number;
  readonly rootDoc: Y.Doc;
  private readonly filesMap: Y.Map<Y.Doc>;
  readonly filenameToSubdoc = new Map<string, Y.Doc>();
  readonly filenameToSubdocAwareness = new Map<string, Awareness>();
  // Subdocs that have already been seeded with disk content. Re-opening a file
  // (e.g. after a rename) must NOT wipe and reload from disk — that would
  // destroy any unflushed in-memory edits.
  private readonly loadedFromDisk = new Set<string>();
  private readonly subdocBroadcastHandlers = new Map<
    Y.Doc,
    (update: Uint8Array) => void
  >();
  private readonly peers = new Map<PeerConnection, PeerState>();
  private readonly pendingOps = new Map<string, PendingOp>();
  private readonly flushTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly inFlightFlushes = new Map<string, Promise<void>>();
  private rescanPromise: Promise<void> | null = null;

  constructor(options: SocketsOptions) {
    this.store = options.store;
    this.gitStore = options.gitStore;
    this.persistIdleMs = options.persistIdleMs ?? 60_000;
    this.rootDoc = new Y.Doc();
    this.filesMap = this.rootDoc.getMap<Y.Doc>("files");

    this.rootDoc.on("subdocs", this.handleSubdocs);
    this.rootDoc.on("update", this.handleRootUpdate);
  }

  // ---- Lifecycle -------------------------------------------------------------

  rescan(): Promise<void> {
    // Coalesce concurrent rescans so the filesystem isn't pounded.
    if (this.rescanPromise) return this.rescanPromise;
    this.rescanPromise = this.doRescan().finally(() => {
      this.rescanPromise = null;
    });
    return this.rescanPromise;
  }

  private async doRescan(): Promise<void> {
    const filesOnDisk = new Set(await this.store.list());

    for (const filename of filesOnDisk) {
      if (!this.filenameToSubdoc.has(filename)) {
        const subdoc = new Y.Doc();
        this.filesMap.set(filename, subdoc);
        this.filenameToSubdoc.set(filename, subdoc);
      }
    }

    for (const [filename, subdoc] of this.filenameToSubdoc) {
      if (!filesOnDisk.has(filename)) {
        subdoc.destroy();
        this.filesMap.delete(filename);
        this.filenameToSubdoc.delete(filename);
        this.filenameToSubdocAwareness.delete(filename);
        this.loadedFromDisk.delete(filename);
      }
    }
  }

  // ---- Peer connect / disconnect ---------------------------------------------

  addPeer(peer: PeerConnection, identity?: PeerIdentity): void {
    this.peers.set(peer, {
      subscriptions: new Set(),
      identity,
      awarenessClientIds: new Map(),
    });
    peer.send(
      encodeMessage(MESSAGE_TYPE_SYNC, Y.encodeStateAsUpdate(this.rootDoc)),
    );
    this.sendFileList(peer);
  }

  removePeer(peer: PeerConnection): void {
    const state = this.peers.get(peer);
    if (state) {
      // Purge this peer's awareness clientIDs from every subdoc's Awareness
      // so survivors stop seeing the leaver's ghost cursor.
      for (const [filename, ids] of state.awarenessClientIds) {
        const awareness = this.filenameToSubdocAwareness.get(filename);
        if (awareness && ids.size > 0) {
          removeAwarenessStates(awareness, [...ids], peer);
        }
      }
    }
    this.peers.delete(peer);
  }

  // ---- Message dispatch ------------------------------------------------------

  async receive(peer: PeerConnection, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) return;
    const messageType = bytes[0];
    const content = bytes.subarray(1);

    if (messageType === MESSAGE_TYPE_SYNC) {
      Y.applyUpdate(this.rootDoc, content, peer);
      return;
    }

    if (messageType === MESSAGE_TYPE_AWARENESS) {
      const stamped = this.stampIdentity(peer, content);
      const frame = encodeMessage(MESSAGE_TYPE_AWARENESS, stamped);
      this.broadcast(frame, peer);
      return;
    }

    if (messageType === MESSAGE_TYPE_SUBDOC_SYNC) {
      const { filename, payload } = decodeFileMessage(content);
      const subdoc = this.filenameToSubdoc.get(filename);
      if (!subdoc) return;
      try {
        Y.applyUpdate(subdoc, payload, peer);
      } catch (error) {
        // A single malformed frame shouldn't tear the connection down.
        console.error(`marky: applyUpdate failed for ${filename}:`, error);
      }
      this.recordPending(filename, peer, { kind: "edit" });
      return;
    }

    if (messageType === MESSAGE_TYPE_SUBDOC_AWARENESS) {
      const { filename, payload } = decodeFileMessage(content);
      const subdoc = this.filenameToSubdoc.get(filename);
      if (!subdoc) return;
      const awareness = this.ensureSubdocAwareness(filename, subdoc);
      const stamped = this.stampIdentity(peer, payload);
      const before = new Set(awareness.getStates().keys());
      applyAwarenessUpdate(awareness, stamped, peer);
      // Track which clientIDs belong to this peer so we can purge them on
      // disconnect.
      const peerState = this.peers.get(peer);
      if (peerState) {
        let ids = peerState.awarenessClientIds.get(filename);
        if (!ids) {
          ids = new Set();
          peerState.awarenessClientIds.set(filename, ids);
        }
        for (const id of awareness.getStates().keys()) {
          if (!before.has(id)) ids.add(id);
        }
      }
      const frame = encodeFileMessage(
        MESSAGE_TYPE_SUBDOC_AWARENESS,
        filename,
        stamped,
      );
      for (const [otherPeer, state] of this.peers) {
        if (
          otherPeer !== peer &&
          state.subscriptions.has(filename) &&
          otherPeer.isOpen()
        ) {
          otherPeer.send(frame);
        }
      }
      return;
    }

    if (messageType === MESSAGE_TYPE_RENAME_FILE) {
      const { oldName, newName } = decodeRenameFrame(content);
      try {
        if (this.filenameToSubdoc.has(newName)) {
          this.sendError(peer, `Cannot rename: ${newName} already exists.`);
          return;
        }
        await this.store.rename({ oldName, newName });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.sendError(peer, `Rename failed: ${message}`);
        return;
      }

      const subdoc = this.filenameToSubdoc.get(oldName);
      if (!subdoc) {
        this.sendError(peer, `Rename source not found: ${oldName}`);
        return;
      }

      // Pre-capture the editor name from awareness keyed on the OLD filename,
      // before we migrate the map keys.
      const editorName = this.editorNameFor(peer, oldName);

      // Migrate all keyed entries.
      this.filenameToSubdoc.delete(oldName);
      this.filenameToSubdoc.set(newName, subdoc);
      this.filesMap.delete(oldName);
      this.filesMap.set(newName, subdoc);
      if (this.loadedFromDisk.delete(oldName)) this.loadedFromDisk.add(newName);
      const awareness = this.filenameToSubdocAwareness.get(oldName);
      if (awareness) {
        this.filenameToSubdocAwareness.delete(oldName);
        this.filenameToSubdocAwareness.set(newName, awareness);
      }
      const pending = this.pendingOps.get(oldName);
      if (pending) {
        this.pendingOps.delete(oldName);
        this.pendingOps.set(newName, pending);
      }
      const timer = this.flushTimers.get(oldName);
      if (timer) {
        this.flushTimers.delete(oldName);
        this.flushTimers.set(newName, timer);
      }
      for (const state of this.peers.values()) {
        if (state.subscriptions.delete(oldName))
          state.subscriptions.add(newName);
        const ids = state.awarenessClientIds.get(oldName);
        if (ids) {
          state.awarenessClientIds.delete(oldName);
          state.awarenessClientIds.set(newName, ids);
        }
      }
      // The broadcaster handler closes over the old filename; rebind it.
      const oldHandler = this.subdocBroadcastHandlers.get(subdoc);
      if (oldHandler) {
        subdoc.off("update", oldHandler);
        this.subdocBroadcastHandlers.delete(subdoc);
      }
      this.ensureSubdocBroadcaster(newName, subdoc);

      this.recordPending(newName, peer, {
        kind: "rename",
        oldName,
        editorName,
      });
      this.broadcastFileList();
      return;
    }

    if (messageType === MESSAGE_TYPE_DELETE_FILE) {
      const filename = decodeUtf8(content);
      if (!this.filenameToSubdoc.has(filename)) return;

      // Capture the editor's display name BEFORE we tear down the awareness
      // map entry; editorNameFor falls back to awareness for anonymous users
      // and would otherwise return 'unknown'.
      const editorName = this.editorNameFor(peer, filename);

      const subdoc = this.filenameToSubdoc.get(filename)!;
      subdoc.destroy();
      this.filenameToSubdoc.delete(filename);
      this.filesMap.delete(filename);
      this.filenameToSubdocAwareness.delete(filename);
      this.loadedFromDisk.delete(filename);
      this.subdocBroadcastHandlers.delete(subdoc);
      for (const state of this.peers.values()) {
        state.subscriptions.delete(filename);
        state.awarenessClientIds.delete(filename);
      }

      try {
        await this.store.remove(filename);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.sendError(peer, `Delete failed: ${message}`);
        return;
      }

      this.recordPending(filename, peer, { kind: "delete", editorName });
      this.broadcastFileList();
      return;
    }

    if (messageType === MESSAGE_TYPE_OPEN_FILE) {
      const filename = decodeUtf8(content);
      let subdoc = this.filenameToSubdoc.get(filename);
      if (!subdoc) {
        subdoc = new Y.Doc();
        this.filesMap.set(filename, subdoc);
        this.filenameToSubdoc.set(filename, subdoc);
      }

      this.peers.get(peer)?.subscriptions.add(filename);
      this.ensureSubdocAwareness(filename, subdoc);
      this.ensureSubdocBroadcaster(filename, subdoc);
      await this.loadFileIntoSubdoc(filename, subdoc);
      subdoc.load();
      this.broadcastFileList();

      peer.send(
        encodeFileMessage(
          MESSAGE_TYPE_SUBDOC_SYNC,
          filename,
          Y.encodeStateAsUpdate(subdoc),
        ),
      );

      const awareness = this.filenameToSubdocAwareness.get(filename);
      if (awareness) {
        const states = [...awareness.getStates().keys()];
        if (states.length > 0) {
          const update = encodeAwarenessUpdate(awareness, states);
          if (update.length > 0) {
            peer.send(
              encodeFileMessage(
                MESSAGE_TYPE_SUBDOC_AWARENESS,
                filename,
                update,
              ),
            );
          }
        }
      }
      return;
    }
  }

  // ---- Helpers --------------------------------------------------------------

  private handleRootUpdate = (update: Uint8Array, origin: unknown): void => {
    const frame = encodeMessage(MESSAGE_TYPE_SYNC, update);
    for (const peer of this.peers.keys()) {
      if (peer !== origin && peer.isOpen()) peer.send(frame);
    }
  };

  private handleSubdocs = ({ loaded }: { loaded: Set<Y.Doc> }): void => {
    for (const subdoc of loaded) {
      for (const [filename, doc] of this.filenameToSubdoc) {
        if (doc === subdoc) {
          this.loadFileIntoSubdoc(filename, doc).catch((error) => {
            console.error(`marky: load failed for ${filename}:`, error);
          });
        }
      }
    }
    this.broadcastFileList();
  };

  private ensureSubdocAwareness(filename: string, subdoc: Y.Doc): Awareness {
    let awareness = this.filenameToSubdocAwareness.get(filename);
    if (!awareness) {
      awareness = new Awareness(subdoc);
      this.filenameToSubdocAwareness.set(filename, awareness);
    }
    return awareness;
  }

  private ensureSubdocBroadcaster(filename: string, subdoc: Y.Doc): void {
    if (this.subdocBroadcastHandlers.has(subdoc)) return;
    const handler = (update: Uint8Array) => {
      const frame = encodeFileMessage(
        MESSAGE_TYPE_SUBDOC_SYNC,
        filename,
        update,
      );
      for (const [peer, state] of this.peers) {
        if (state.subscriptions.has(filename) && peer.isOpen())
          peer.send(frame);
      }
    };
    subdoc.on("update", handler);
    this.subdocBroadcastHandlers.set(subdoc, handler);
  }

  private async loadFileIntoSubdoc(
    filename: string,
    subdoc: Y.Doc,
  ): Promise<void> {
    // Only seed a subdoc once. Calling this on every OPEN_FILE would wipe
    // unflushed in-memory edits whenever a client re-opens the file (which
    // the editor does after a rename, and after any tab switch back).
    if (this.loadedFromDisk.has(filename)) return;
    const content = await this.store.readOrCreate(filename);
    const doc = textToDoc(content);
    const fragment = subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
    fragment.delete(0, fragment.length);
    prosemirrorToYXmlFragment(doc, fragment);
    this.loadedFromDisk.add(filename);
  }

  private async persistSubdocToDisk(
    filename: string,
    subdoc: Y.Doc,
  ): Promise<boolean> {
    try {
      const fragment = subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
      const doc = yXmlFragmentToProseMirrorRootNode(fragment, plainTextSchema);
      await this.store.write(filename, docToText(doc));
      return true;
    } catch (error) {
      console.error(`marky: persist failed for ${filename}:`, error);
      return false;
    }
  }

  private recordPending(
    filename: string,
    peer: PeerConnection,
    incoming: { kind: PendingOpKind; oldName?: string; editorName?: string },
  ): void {
    const editorName =
      incoming.editorName ?? this.editorNameFor(peer, filename);
    const existing = this.pendingOps.get(filename);

    let kind: PendingOpKind;
    let oldName: string | undefined;
    const editors = existing ? existing.editors : new Set<string>();
    editors.add(editorName);

    if (!existing) {
      kind = incoming.kind;
      oldName = incoming.oldName;
    } else if (existing.kind === "delete") {
      kind = "delete";
      oldName = undefined;
    } else if (incoming.kind === "delete") {
      kind = "delete";
      oldName = undefined;
    } else if (existing.kind === "rename") {
      kind = "rename";
      // Preserve the earliest oldName so A -> B -> C becomes a single rename A -> C.
      oldName = existing.oldName;
    } else if (incoming.kind === "rename") {
      kind = "rename";
      oldName = incoming.oldName;
    } else {
      kind = "edit";
      oldName = undefined;
    }

    this.pendingOps.set(filename, { kind, editors, oldName });
    this.scheduleFlush(filename);
  }

  private scheduleFlush(filename: string): void {
    const existing = this.flushTimers.get(filename);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.flushTimers.delete(filename);
      const promise = this.flush(filename)
        .catch((error) => {
          console.error(`marky: flush failed for ${filename}:`, error);
        })
        .finally(() => {
          if (this.inFlightFlushes.get(filename) === promise) {
            this.inFlightFlushes.delete(filename);
          }
        });
      this.inFlightFlushes.set(filename, promise);
    }, this.persistIdleMs);
    this.flushTimers.set(filename, timer);
  }

  // Wait for any in-flight or pending flushes to settle. Tests fire mocked
  // timers and then await this to drain the persist/commit pipeline.
  async waitForFlushes(): Promise<void> {
    while (this.inFlightFlushes.size > 0) {
      await Promise.all(this.inFlightFlushes.values());
    }
  }

  private editorNameFor(peer: PeerConnection, filename: string): string {
    const identity = this.peers.get(peer)?.identity;
    if (identity) return identity.name;

    // Anonymous mode: pull from the most recent awareness state on this file.
    const awareness = this.filenameToSubdocAwareness.get(filename);
    if (awareness) {
      for (const state of awareness.getStates().values()) {
        const user = (state as { user?: { name?: string } }).user;
        if (user?.name) return user.name;
      }
    }
    return "unknown";
  }

  private async flush(filename: string): Promise<void> {
    const op = this.pendingOps.get(filename);
    if (!op) return;
    this.pendingOps.delete(filename);

    const editors = Array.from(op.editors).toSorted().join(", ") || "unknown";

    if (op.kind === "edit") {
      const subdoc = this.filenameToSubdoc.get(filename);
      if (!subdoc) return;
      const ok = await this.persistSubdocToDisk(filename, subdoc);
      if (!ok || !this.gitStore) return;

      const relPath = this.relPath(filename);
      await this.gitStore.stageEdit({ path: relPath });
      await this.gitStore.commit(`edit ${filename} by ${editors}`);
      return;
    }

    if (op.kind === "rename") {
      if (!op.oldName) {
        console.error(`marky: rename flush for ${filename} missing oldName`);
        return;
      }
      const subdoc = this.filenameToSubdoc.get(filename);
      if (subdoc) await this.persistSubdocToDisk(filename, subdoc);
      if (!this.gitStore) return;
      // Stage the edit first; the rename is the dominant op for commit kind.
      await this.gitStore.stageEdit({ path: this.relPath(filename) });
      await this.gitStore.stageRename({
        oldPath: this.relPath(op.oldName),
        newPath: this.relPath(filename),
      });
      await this.gitStore.commit(
        `rename ${op.oldName} to ${filename} by ${editors}`,
      );
      return;
    }

    if (op.kind === "delete") {
      if (!this.gitStore) return;
      await this.gitStore.stageDelete({ path: this.relPath(filename) });
      await this.gitStore.commit(`delete ${filename} by ${editors}`);
      return;
    }
  }

  private relPath(filename: string): string {
    if (!this.gitStore) {
      throw new Error("relPath called without a gitStore configured");
    }
    const repoDir = this.gitStore.repoDir;
    const fullPath = this.store.filePath(filename);
    if (!fullPath.startsWith(repoDir)) {
      throw new Error(
        `marky: content dir ${this.store.dir} is not inside git repo ${repoDir}`,
      );
    }
    return fullPath.slice(repoDir.length).replace(/^[/\\]+/, "");
  }

  private pushTimer?: ReturnType<typeof setInterval>;

  attachPushTimer(timer: ReturnType<typeof setInterval>): void {
    this.pushTimer = timer;
  }

  async dispose(): Promise<void> {
    // Wait for in-flight flushes so a mid-commit doesn't get orphaned.
    await this.waitForFlushes();
    for (const timer of this.flushTimers.values()) clearTimeout(timer);
    this.flushTimers.clear();
    this.pendingOps.clear();
    if (this.pushTimer) {
      clearInterval(this.pushTimer);
      this.pushTimer = undefined;
    }
  }

  private sendFileList(peer: PeerConnection): void {
    const files = Array.from(this.filenameToSubdoc.keys()).toSorted();
    peer.send(
      encodeMessage(MESSAGE_TYPE_FILE_LIST, encodeUtf8(JSON.stringify(files))),
    );
  }

  private broadcastFileList(): void {
    for (const peer of this.peers.keys()) {
      if (peer.isOpen()) this.sendFileList(peer);
    }
  }

  private broadcast(frame: Uint8Array, exclude?: PeerConnection): void {
    for (const peer of this.peers.keys()) {
      if (peer !== exclude && peer.isOpen()) peer.send(frame);
    }
  }

  private sendError(peer: PeerConnection, message: string): void {
    if (!peer.isOpen()) return;
    peer.send(encodeMessage(MESSAGE_TYPE_ERROR, encodeUtf8(message)));
  }

  // If a peer has a server-bound identity, rewrite the awareness `user`
  // field on every outgoing update so clients can't forge their display name
  // or color. Anonymous peers pass through unchanged.
  private stampIdentity(peer: PeerConnection, update: Uint8Array): Uint8Array {
    const identity = this.peers.get(peer)?.identity;
    if (!identity) return update;
    return modifyAwarenessUpdate(update, (state) => ({
      ...state,
      user: identity,
    }));
  }
}
