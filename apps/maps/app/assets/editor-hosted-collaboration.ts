import {
  planMapSave,
  rebaseMapSource,
  selectedBrushIds,
  selectedPointEntityIds,
  type EditorSession,
  type CollaborationOperation,
  type MapDocument,
  type MapSourceState,
} from "@tea/maps-editor/core";
import {
  HostedMapSnapshotSchema,
  HostedRealtimeTicketResponseSchema,
  type HostedMapLaunch,
  type HostedMapSnapshot,
  type CollaborationPresence,
} from "@tea/maps-protocol";
import type { EditorPointerPositionEvent } from "@tea/maps-editor/render";

import {
  CollaborationController,
  CollaborationSocketClient,
  EditorCollaborationBridge,
  IndexedDbCollaborationOutbox,
  reconcilePendingOperations,
  type DetachedHostedMap,
} from "./editor-collaboration.ts";

interface HostedEditorCallbacks {
  update(document: MapDocument, source: string, mapVersion: number): void;
  presence(participants: readonly CollaborationPresence[]): void;
  history(): void;
  status(message: string): void;
  detached(copy: DetachedHostedMap): void;
  failure(error: unknown): void;
}

export interface HostedEditorConnection {
  close(): void;
  pending(): Promise<boolean>;
  detach(reason: string): Promise<DetachedHostedMap | null>;
  publishPointer(pointer: EditorPointerPositionEvent): void;
  canUndo(): boolean;
  canRedo(): boolean;
  undoLabel(): string | null;
  redoLabel(): string | null;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

const PRESENCE_INTERVAL_MS = 2_000;
const PRESENCE_MIN_INTERVAL_MS = 33;
const PRESENCE_EXPIRY_MS = 10_000;
const COLLABORATOR_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "pink",
] as const;

function collaboratorColor(actorId: string): string {
  let hash = 2_166_136_261;
  for (const character of actorId)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return COLLABORATOR_COLORS[(hash >>> 0) % COLLABORATOR_COLORS.length]!;
}

async function issueTicket(mapId: string): Promise<string> {
  const response = await fetch(
    `/api/maps/${encodeURIComponent(mapId)}/realtime-ticket`,
    { method: "POST", credentials: "same-origin" },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(`Cannot join map room (${response.status})`);
  const ticket = HostedRealtimeTicketResponseSchema.safeParse(payload);
  if (!ticket.success) throw new Error("Invalid map room ticket");
  return ticket.data.ticket;
}

async function roomSnapshot(mapId: string, ticket: string) {
  const response = await fetch(
    `/sync/maps/${encodeURIComponent(mapId)}/snapshot`,
    {
      headers: { Authorization: `Bearer ${ticket}` },
      credentials: "same-origin",
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(`Cannot read map room (${response.status})`);
  const snapshot = HostedMapSnapshotSchema.safeParse(payload);
  if (!snapshot.success) throw new Error("Invalid map room snapshot");
  return snapshot.data;
}

export async function connectHostedEditor(
  map: HostedMapLaunch,
  session: EditorSession,
  callbacks: HostedEditorCallbacks,
): Promise<HostedEditorConnection | null> {
  const outbox = new IndexedDbCollaborationOutbox();
  const detach = async (reason: string) => {
    const copy = await outbox.detach(map.id, reason, Date.now());
    if (!copy)
      throw new Error("Hosted edits cannot be recovered from local storage");
    callbacks.detached(copy);
    return copy;
  };
  const preflight = await outbox.connectionChanged(map.id, Date.now());
  if (preflight.status === "detach") {
    await detach(preflight.reason);
    return null;
  }

  const ticket = await issueTicket(map.id);
  const snapshot = await roomSnapshot(map.id, ticket);
  const pending = await outbox.pending(map.id);
  const initial = reconcilePendingOperations(snapshot.document, pending);
  if (initial.conflicts.length > 0) {
    await detach("Hosted edits conflict with the current room map");
    return null;
  }
  const undoStack: CollaborationOperation[] = pending.filter(
    (operation) =>
      operation.actorId === map.actorId && !!operation.inverseEdits?.length,
  );
  const redoStack: CollaborationOperation[] = [];
  let manipulatingHistory = false;

  let sourceState: MapSourceState = rebaseMapSource(
    snapshot.document,
    snapshot.source,
  );
  let mapVersion = snapshot.mapVersion;
  let stopped = false;
  let synchronizing = false;
  let pointer: EditorPointerPositionEvent | null = null;
  let lastPresenceAt = 0;
  let presenceTimeout: ReturnType<typeof setTimeout> | null = null;
  const remotePresence = new Map<
    string,
    { presence: CollaborationPresence; receivedAt: number }
  >();
  let bridge: EditorCollaborationBridge;
  let socket: CollaborationSocketClient;

  const renderPresence = () => {
    if (stopped) return;
    callbacks.presence(
      [...remotePresence.values()].map(({ presence }) => presence),
    );
  };
  const sendPresence = () => {
    if (stopped) return;
    lastPresenceAt = performance.now();
    socket.sendPresence({
      actorId: map.actorId,
      displayName: map.displayName,
      color: collaboratorColor(map.actorId),
      selectedObjectIds: [
        ...selectedBrushIds(session.selection),
        ...selectedPointEntityIds(session.selection),
      ],
      ...(pointer
        ? { viewport: pointer.viewport, pointer: pointer.point }
        : {}),
      sentAt: Date.now(),
    });
  };
  const schedulePresence = () => {
    if (stopped || presenceTimeout !== null) return;
    const delay = Math.max(
      0,
      PRESENCE_MIN_INTERVAL_MS - (performance.now() - lastPresenceAt),
    );
    presenceTimeout = setTimeout(() => {
      presenceTimeout = null;
      sendPresence();
    }, delay);
  };

  const update = (document: MapDocument, exact?: HostedMapSnapshot) => {
    if (stopped) return;
    if (exact) sourceState = rebaseMapSource(exact.document, exact.source);
    const plan = planMapSave(document, sourceState);
    if (plan.status === "blocked") {
      callbacks.failure(
        new Error("Hosted edit cannot be saved safely as map source"),
      );
      return;
    }
    sourceState = rebaseMapSource(document, plan.text);
    callbacks.update(document, plan.text, mapVersion);
  };

  session.replaceDocument(initial.document, `Open hosted map ${map.id}`);
  update(initial.document, snapshot);

  const controller = new CollaborationController({
    mapId: map.id,
    actorId: map.actorId,
    outbox,
    captureRecovery(document, version) {
      const plan = planMapSave(document, sourceState);
      if (plan.status === "blocked")
        throw new Error("Hosted edit cannot be preserved as a local copy");
      return {
        version: 1,
        mapId: map.id,
        documentKey: `tea-maps-hosted:${map.id}`,
        fileName: `${map.slug}.map`,
        profile: map.game,
        document: structuredClone(document),
        source: rebaseMapSource(document, plan.text),
        savedDocumentRevision: snapshot.document.revision,
        mapVersion: version,
        updatedAt: Date.now(),
      };
    },
    onDetached(copy) {
      callbacks.detached(copy);
    },
    onPeerOperation(operation) {
      if (stopped) return;
      try {
        bridge.receive(operation);
        mapVersion = controller.getMapVersion();
        update(session.document);
        const previous = remotePresence.get(operation.actorId);
        if (previous?.presence.preview) {
          remotePresence.set(operation.actorId, {
            ...previous,
            presence: { ...previous.presence, preview: undefined },
          });
          renderPresence();
        }
      } catch (error) {
        callbacks.failure(error);
      }
    },
    onAcknowledged(_operationId, version) {
      if (stopped) return;
      mapVersion = version;
      update(session.document);
      void controller.pending().then((operations) => {
        if (!stopped && operations.length === 0)
          callbacks.status(`Hosted map saved · v${version}`);
      });
    },
  });
  controller.setMapVersion(snapshot.mapVersion);
  const unsubscribeHistory = controller.subscribeLocalOperations(
    (operation) => {
      if (stopped || manipulatingHistory) return;
      undoStack.push(operation);
      redoStack.length = 0;
      callbacks.history();
    },
  );
  bridge = new EditorCollaborationBridge(
    session,
    controller,
    callbacks.failure,
  );
  const unsubscribe = session.subscribe((change) => {
    if (
      !synchronizing &&
      (change.kind === "document" || change.kind === "history")
    ) {
      update(session.document);
    }
    if (change.kind === "selection" || change.kind === "document")
      schedulePresence();
  });

  const endpoint = new URL(location.href);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  socket = new CollaborationSocketClient({
    endpoint: endpoint.toString(),
    mapId: map.id,
    actorId: map.actorId,
    authorize: () => issueTicket(map.id),
    controller,
    onReady: async (ready) => {
      if (stopped) return;
      remotePresence.clear();
      renderPresence();
      const queued = await controller.pending();
      if (stopped) return;
      const reconciled = reconcilePendingOperations(ready.document, queued);
      if (reconciled.conflicts.length > 0) {
        await detach("Hosted edits conflict after reconnect");
        socket.close();
        return;
      }
      mapVersion = ready.mapVersion;
      synchronizing = true;
      try {
        bridge.synchronize(() =>
          session.replaceDocument(
            reconciled.document,
            "Synchronize hosted map",
          ),
        );
      } finally {
        synchronizing = false;
      }
      update(reconciled.document, ready);
      sendPresence();
    },
    onPresence(presence) {
      if (stopped || presence.actorId === map.actorId) return;
      const previous = remotePresence.get(presence.actorId)?.presence;
      if (previous && presence.sentAt < previous.sentAt) return;
      if (
        previous?.preview &&
        presence.preview?.interactionId === previous.preview.interactionId &&
        presence.preview.sequence <= previous.preview.sequence
      )
        return;
      remotePresence.set(presence.actorId, {
        presence,
        receivedAt: Date.now(),
      });
      renderPresence();
    },
    onConflict(_operationId, conflicts) {
      callbacks.failure(
        new Error(
          conflicts.map((conflict) => conflict.message).join("; ") ||
            "Hosted edit conflicted with another change",
        ),
      );
    },
    onError(error) {
      if (!stopped)
        callbacks.status(
          error instanceof Error ? error.message : "Map room connection failed",
        );
    },
    onConnectionChange(state) {
      if (!stopped) callbacks.status(`Hosted map · ${state}`);
    },
  });
  const presenceInterval = setInterval(() => {
    let removed = false;
    for (const [actorId, entry] of remotePresence) {
      if (Date.now() - entry.receivedAt > PRESENCE_EXPIRY_MS) {
        remotePresence.delete(actorId);
        removed = true;
      }
    }
    if (removed) renderPresence();
    sendPresence();
  }, PRESENCE_INTERVAL_MS);
  socket.connect();

  return {
    close() {
      if (stopped) return;
      stopped = true;
      clearInterval(presenceInterval);
      if (presenceTimeout !== null) clearTimeout(presenceTimeout);
      remotePresence.clear();
      callbacks.presence([]);
      unsubscribe();
      unsubscribeHistory();
      socket.close();
      bridge.close();
    },
    async pending() {
      return (await outbox.pending(map.id)).length > 0;
    },
    detach,
    publishPointer(value) {
      pointer = value;
      schedulePresence();
    },
    canUndo() {
      return !stopped && !manipulatingHistory && undoStack.length > 0;
    },
    canRedo() {
      return !stopped && !manipulatingHistory && redoStack.length > 0;
    },
    undoLabel() {
      return undoStack.at(-1)?.label ?? null;
    },
    redoLabel() {
      return redoStack.at(-1)?.label.replace(/^Undo /, "") ?? null;
    },
    async undo() {
      if (stopped || manipulatingHistory) return;
      const operation = undoStack.pop();
      if (!operation) return;
      manipulatingHistory = true;
      try {
        const inverse = await bridge.undo(operation);
        redoStack.push(inverse);
      } catch (error) {
        undoStack.push(operation);
        throw error;
      } finally {
        manipulatingHistory = false;
        callbacks.history();
      }
    },
    async redo() {
      if (stopped || manipulatingHistory) return;
      const operation = redoStack.pop();
      if (!operation) return;
      manipulatingHistory = true;
      try {
        const inverse = await bridge.undo(operation);
        undoStack.push(inverse);
      } catch (error) {
        redoStack.push(operation);
        throw error;
      } finally {
        manipulatingHistory = false;
        callbacks.history();
      }
    },
  };
}
