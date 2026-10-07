import {
  CollaborationOperationSchema,
  MapDocumentSchema,
  MapSourceStateSchema,
  WorldviewGameProfileSchema,
  type CollaborationOperation,
  type MapDocument,
  type MapSourceState,
  type WorldviewGameProfile,
} from "@tea/maps-editor/core";
import { z } from "zod";

import {
  completeEditorTransaction,
  EDITOR_STORES,
  openEditorDatabase,
} from "./editor-collaboration-database.ts";

export const HOSTED_RECONNECT_GRACE_MS = 15 * 60 * 1_000;
export const HOSTED_RECONNECT_MAX_OPERATIONS = 200;
export const HOSTED_RECONNECT_MAX_BYTES = 4 * 1_024 * 1_024;

export interface HostedMapRecoverySnapshot {
  readonly version: 1;
  readonly mapId: string;
  readonly documentKey: string;
  readonly fileName: string;
  readonly profile: WorldviewGameProfile;
  readonly document: MapDocument;
  readonly source: MapSourceState;
  readonly savedDocumentRevision: number;
  readonly mapVersion: number;
  readonly updatedAt: number;
}

export interface DetachedHostedMap {
  readonly version: 1;
  readonly id: string;
  readonly originalMapId: string;
  readonly documentKey: string;
  readonly fileName: string;
  readonly profile: WorldviewGameProfile;
  readonly document: MapDocument;
  readonly source: MapSourceState;
  readonly originalMapVersion: number;
  readonly createdAt: number;
  readonly reason: string;
  readonly operationCount: number;
  readonly encodedBytes: number;
}

export interface StoredCollaborationOperation {
  readonly version: 1;
  readonly key: string;
  readonly mapId: string;
  readonly operation: CollaborationOperation;
  readonly encodedBytes: number;
  readonly recordedAt: number;
  readonly localSequence: number;
}

export interface StoredCollaborationSession {
  readonly version: 1;
  readonly mapId: string;
  readonly mapVersion: number;
  readonly dirtySince: number | null;
  readonly operationCount: number;
  readonly encodedBytes: number;
  readonly recovery: HostedMapRecoverySnapshot | null;
  readonly updatedAt: number;
}

const RecoverySnapshotSchema = z.strictObject({
  version: z.literal(1),
  mapId: z.string().min(1).max(256),
  documentKey: z.string().min(1).max(4_096),
  fileName: z.string().min(1).max(4_096),
  profile: WorldviewGameProfileSchema,
  document: MapDocumentSchema,
  source: MapSourceStateSchema,
  savedDocumentRevision: z.number().int(),
  mapVersion: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}) satisfies z.ZodType<HostedMapRecoverySnapshot>;

const StoredOperationSchema = z.strictObject({
  version: z.literal(1),
  key: z.string().min(1).max(4_096),
  mapId: z.string().min(1).max(256),
  operation: CollaborationOperationSchema,
  encodedBytes: z.number().int().nonnegative(),
  recordedAt: z.number().int().nonnegative(),
  localSequence: z.number().int().nonnegative(),
}) satisfies z.ZodType<StoredCollaborationOperation>;

const StoredSessionSchema = z.strictObject({
  version: z.literal(1),
  mapId: z.string().min(1).max(256),
  mapVersion: z.number().int().nonnegative(),
  dirtySince: z.number().int().nonnegative().nullable(),
  operationCount: z.number().int().nonnegative(),
  encodedBytes: z.number().int().nonnegative(),
  recovery: RecoverySnapshotSchema.nullable(),
  updatedAt: z.number().int().nonnegative(),
}) satisfies z.ZodType<StoredCollaborationSession>;

export const DetachedHostedMapSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1).max(256),
  originalMapId: z.string().min(1).max(256),
  documentKey: z.string().min(1).max(4_096),
  fileName: z.string().min(1).max(4_096),
  profile: WorldviewGameProfileSchema,
  document: MapDocumentSchema,
  source: MapSourceStateSchema,
  originalMapVersion: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  reason: z.string().min(1).max(4_096),
  operationCount: z.number().int().positive(),
  encodedBytes: z.number().int().positive(),
}) satisfies z.ZodType<DetachedHostedMap>;

export interface HostedReconnectSummary {
  readonly mapId: string;
  readonly mapVersion: number;
  readonly dirtySince: number | null;
  readonly operationCount: number;
  readonly encodedBytes: number;
  readonly recovery: HostedMapRecoverySnapshot | null;
}

export type HostedReconnectDecision =
  | { readonly status: "clean"; readonly summary: HostedReconnectSummary }
  | { readonly status: "replay"; readonly summary: HostedReconnectSummary }
  | {
      readonly status: "detach";
      readonly summary: HostedReconnectSummary;
      readonly reason: string;
    };

export interface HostedReconnectLimits {
  readonly graceMilliseconds: number;
  readonly maxOperations: number;
  readonly maxEncodedBytes: number;
}

export const DEFAULT_HOSTED_RECONNECT_LIMITS: HostedReconnectLimits = {
  graceMilliseconds: HOSTED_RECONNECT_GRACE_MS,
  maxOperations: HOSTED_RECONNECT_MAX_OPERATIONS,
  maxEncodedBytes: HOSTED_RECONNECT_MAX_BYTES,
};

export interface RecordCollaborationOperationOptions {
  readonly mapVersion: number;
  readonly connected: boolean;
  readonly recordedAt: number;
  readonly localSequence?: number;
  readonly recovery?: HostedMapRecoverySnapshot;
}

export interface CollaborationOutbox {
  put(
    mapId: string,
    operation: CollaborationOperation,
    options?: RecordCollaborationOperationOptions,
  ): Promise<HostedReconnectDecision>;
  pending(mapId: string): Promise<readonly CollaborationOperation[]>;
  acknowledge(
    mapId: string,
    operationId: string,
    mapVersion?: number,
  ): Promise<void>;
  connectionChanged(
    mapId: string,
    changedAt: number,
  ): Promise<HostedReconnectDecision>;
  inspect(mapId: string, now?: number): Promise<HostedReconnectDecision>;
  detach(
    mapId: string,
    reason: string,
    createdAt: number,
  ): Promise<DetachedHostedMap | null>;
  loadDetached(id: string): Promise<DetachedHostedMap | null>;
  listDetached(): Promise<readonly DetachedHostedMap[]>;
}

function operationKey(mapId: string, operationId: string): string {
  return `${mapId}\u0000${operationId}`;
}

function operationBytes(operation: CollaborationOperation): number {
  return new TextEncoder().encode(
    JSON.stringify({ type: "operation", operation }),
  ).byteLength;
}

function storedOperation(
  mapId: string,
  operation: CollaborationOperation,
  options: RecordCollaborationOperationOptions,
): StoredCollaborationOperation {
  return {
    version: 1,
    key: operationKey(mapId, operation.operationId),
    mapId,
    operation,
    encodedBytes: operationBytes(operation),
    recordedAt: options.recordedAt,
    localSequence: options.localSequence ?? 0,
  };
}

function sessionAfterPut(
  mapId: string,
  previous: StoredCollaborationSession | null,
  operation: StoredCollaborationOperation,
  operationExists: boolean,
  options: RecordCollaborationOperationOptions,
): StoredCollaborationSession {
  return {
    version: 1,
    mapId,
    mapVersion: Math.max(previous?.mapVersion ?? 0, options.mapVersion),
    dirtySince:
      previous?.dirtySince ?? (options.connected ? null : options.recordedAt),
    operationCount: (previous?.operationCount ?? 0) + (operationExists ? 0 : 1),
    encodedBytes:
      (previous?.encodedBytes ?? 0) +
      (operationExists ? 0 : operation.encodedBytes),
    recovery: options.recovery ?? previous?.recovery ?? null,
    updatedAt: options.recordedAt,
  };
}

function sessionAfterConnection(
  summary: HostedReconnectSummary,
  changedAt: number,
): StoredCollaborationSession {
  return {
    version: 1,
    mapId: summary.mapId,
    mapVersion: summary.mapVersion,
    dirtySince: summary.dirtySince ?? changedAt,
    operationCount: summary.operationCount,
    encodedBytes: summary.encodedBytes,
    recovery: summary.recovery,
    updatedAt: changedAt,
  };
}

function createDetachedMap(
  mapId: string,
  session: StoredCollaborationSession,
  operations: readonly StoredCollaborationOperation[],
  reason: string,
  createdAt: number,
): DetachedHostedMap {
  const recovery = session.recovery;
  if (!recovery)
    throw new Error("Cannot detach hosted edits without a recovery snapshot");
  const id = crypto.randomUUID();
  return {
    version: 1,
    id,
    originalMapId: mapId,
    documentKey: `detached-hosted:${id}`,
    fileName: recovery.fileName,
    profile: recovery.profile,
    document: recovery.document,
    source: recovery.source,
    originalMapVersion: session.mapVersion,
    createdAt,
    reason,
    operationCount: operations.length,
    encodedBytes: operations.reduce(
      (total, operation) => total + operation.encodedBytes,
      0,
    ),
  };
}

function emptySummary(mapId: string): HostedReconnectSummary {
  return {
    mapId,
    mapVersion: 0,
    dirtySince: null,
    operationCount: 0,
    encodedBytes: 0,
    recovery: null,
  };
}

function storedSessionSummary(
  session: StoredCollaborationSession,
): HostedReconnectSummary {
  return {
    mapId: session.mapId,
    mapVersion: session.mapVersion,
    dirtySince: session.dirtySince,
    operationCount: session.operationCount,
    encodedBytes: session.encodedBytes,
    recovery: session.recovery,
  };
}

export function decideHostedReconnect(
  summary: HostedReconnectSummary,
  now: number,
  limits: HostedReconnectLimits = DEFAULT_HOSTED_RECONNECT_LIMITS,
): HostedReconnectDecision {
  if (summary.operationCount === 0) return { status: "clean", summary };
  if (summary.operationCount > limits.maxOperations) {
    return {
      status: "detach",
      summary,
      reason: `Offline edit limit reached (${summary.operationCount} operations).`,
    };
  }
  if (summary.encodedBytes > limits.maxEncodedBytes) {
    return {
      status: "detach",
      summary,
      reason: `Offline edit limit reached (${summary.encodedBytes} encoded bytes).`,
    };
  }
  if (
    summary.dirtySince !== null &&
    now - summary.dirtySince > limits.graceMilliseconds
  ) {
    return {
      status: "detach",
      summary,
      reason: "Offline edit limit reached (the reconnect window expired).",
    };
  }
  return { status: "replay", summary };
}

function parsedOperations(
  values: readonly unknown[],
): readonly StoredCollaborationOperation[] {
  return values.flatMap((value) => {
    const parsed = StoredOperationSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function parsedSession(value: unknown): StoredCollaborationSession | null {
  const parsed = StoredSessionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function summaryFrom(
  mapId: string,
  session: StoredCollaborationSession | null,
  operations: readonly StoredCollaborationOperation[],
): HostedReconnectSummary {
  const encodedBytes = operations.reduce(
    (total, operation) => total + operation.encodedBytes,
    0,
  );
  const oldestRecordedAt = Math.min(
    ...operations.map(({ recordedAt }) => recordedAt),
  );
  return {
    mapId,
    mapVersion: session?.mapVersion ?? 0,
    dirtySince:
      operations.length === 0
        ? null
        : (session?.dirtySince ??
          (Number.isFinite(oldestRecordedAt) ? oldestRecordedAt : null)),
    operationCount: operations.length,
    encodedBytes,
    recovery: session?.recovery ?? null,
  };
}

export class IndexedDbCollaborationOutbox implements CollaborationOutbox {
  public constructor(
    private readonly limits: HostedReconnectLimits = DEFAULT_HOSTED_RECONNECT_LIMITS,
  ) {}

  public async put(
    mapId: string,
    operation: CollaborationOperation,
    options: RecordCollaborationOperationOptions = {
      mapVersion: operation.baseMapVersion,
      connected: false,
      recordedAt: Date.now(),
    },
  ): Promise<HostedReconnectDecision> {
    const database = await openEditorDatabase();
    const transaction = database.transaction(
      [
        EDITOR_STORES.collaborationOperations,
        EDITOR_STORES.collaborationSessions,
      ],
      "readwrite",
    );
    const operationStore = transaction.objectStore(
      EDITOR_STORES.collaborationOperations,
    );
    const sessionStore = transaction.objectStore(
      EDITOR_STORES.collaborationSessions,
    );
    const result = await completeEditorTransaction(
      transaction,
      (async () => {
        const nextOperation = storedOperation(mapId, operation, options);
        const existing = StoredOperationSchema.safeParse(
          await operationStore.get(nextOperation.key),
        );
        const previous = parsedSession(await sessionStore.get(mapId));
        if (!existing.success) await operationStore.put(nextOperation);
        const session = sessionAfterPut(
          mapId,
          previous,
          nextOperation,
          existing.success,
          options,
        );
        await sessionStore.put(session);
        return decideHostedReconnect(
          storedSessionSummary(session),
          options.recordedAt,
          this.limits,
        );
      })(),
    );
    return result;
  }

  public async pending(
    mapId: string,
  ): Promise<readonly CollaborationOperation[]> {
    const values: unknown[] = await (
      await openEditorDatabase()
    ).getAllFromIndex(EDITOR_STORES.collaborationOperations, "mapId", mapId);
    return parsedOperations(values)
      .toSorted(
        (left, right) =>
          left.recordedAt - right.recordedAt ||
          left.localSequence - right.localSequence ||
          left.operation.operationId.localeCompare(right.operation.operationId),
      )
      .map(({ operation }) => operation);
  }

  public async acknowledge(
    mapId: string,
    operationId: string,
    mapVersion = 0,
  ): Promise<void> {
    const database = await openEditorDatabase();
    const transaction = database.transaction(
      [
        EDITOR_STORES.collaborationOperations,
        EDITOR_STORES.collaborationSessions,
      ],
      "readwrite",
    );
    const operationStore = transaction.objectStore(
      EDITOR_STORES.collaborationOperations,
    );
    const sessionStore = transaction.objectStore(
      EDITOR_STORES.collaborationSessions,
    );
    await completeEditorTransaction(
      transaction,
      (async () => {
        const key = operationKey(mapId, operationId);
        const operation = StoredOperationSchema.safeParse(
          await operationStore.get(key),
        );
        if (!operation.success) return;
        await operationStore.delete(key);
        const previous = parsedSession(await sessionStore.get(mapId));
        if (!previous) return;
        const operationCount = Math.max(0, previous.operationCount - 1);
        if (operationCount === 0) {
          await sessionStore.delete(mapId);
          return;
        }
        const session: StoredCollaborationSession = {
          ...previous,
          mapVersion: Math.max(previous.mapVersion, mapVersion),
          operationCount,
          encodedBytes: Math.max(
            0,
            previous.encodedBytes - operation.data.encodedBytes,
          ),
          updatedAt: Date.now(),
        };
        await sessionStore.put(session);
      })(),
    );
  }

  public async connectionChanged(
    mapId: string,
    changedAt: number,
  ): Promise<HostedReconnectDecision> {
    const database = await openEditorDatabase();
    const transaction = database.transaction(
      [
        EDITOR_STORES.collaborationOperations,
        EDITOR_STORES.collaborationSessions,
      ],
      "readwrite",
    );
    const operationStore = transaction.objectStore(
      EDITOR_STORES.collaborationOperations,
    );
    const sessionStore = transaction.objectStore(
      EDITOR_STORES.collaborationSessions,
    );
    return completeEditorTransaction(
      transaction,
      (async () => {
        const operations = parsedOperations(
          await operationStore.index("mapId").getAll(mapId),
        );
        const previous = parsedSession(await sessionStore.get(mapId));
        if (operations.length === 0) {
          if (previous) await sessionStore.delete(mapId);
          return { status: "clean", summary: emptySummary(mapId) };
        }
        const summary = summaryFrom(mapId, previous, operations);
        const next = sessionAfterConnection(summary, changedAt);
        await sessionStore.put(next);
        return decideHostedReconnect(
          { ...summary, dirtySince: next.dirtySince },
          changedAt,
          this.limits,
        );
      })(),
    );
  }

  public async inspect(
    mapId: string,
    now = Date.now(),
  ): Promise<HostedReconnectDecision> {
    const database = await openEditorDatabase();
    const [operationValues, sessionValue] = await Promise.all([
      database.getAllFromIndex(
        EDITOR_STORES.collaborationOperations,
        "mapId",
        mapId,
      ),
      database.get(EDITOR_STORES.collaborationSessions, mapId),
    ]);
    const operations = parsedOperations(operationValues);
    if (operations.length === 0)
      return { status: "clean", summary: emptySummary(mapId) };
    return decideHostedReconnect(
      summaryFrom(mapId, parsedSession(sessionValue), operations),
      now,
      this.limits,
    );
  }

  public async detach(
    mapId: string,
    reason: string,
    createdAt: number,
  ): Promise<DetachedHostedMap | null> {
    const database = await openEditorDatabase();
    const transaction = database.transaction(
      [
        EDITOR_STORES.collaborationOperations,
        EDITOR_STORES.collaborationSessions,
        EDITOR_STORES.detachedMaps,
      ],
      "readwrite",
    );
    const operationStore = transaction.objectStore(
      EDITOR_STORES.collaborationOperations,
    );
    const sessionStore = transaction.objectStore(
      EDITOR_STORES.collaborationSessions,
    );
    const detachedStore = transaction.objectStore(EDITOR_STORES.detachedMaps);
    return completeEditorTransaction(
      transaction,
      (async () => {
        const operations = parsedOperations(
          await operationStore.index("mapId").getAll(mapId),
        );
        const session = parsedSession(await sessionStore.get(mapId));
        if (operations.length === 0 || !session?.recovery) return null;
        const copy = createDetachedMap(
          mapId,
          session,
          operations,
          reason,
          createdAt,
        );
        await detachedStore.put(copy);
        await Promise.all(
          operations.map((operation) => operationStore.delete(operation.key)),
        );
        await sessionStore.delete(mapId);
        return copy;
      })(),
    );
  }

  public async loadDetached(id: string): Promise<DetachedHostedMap | null> {
    const value: unknown = await (
      await openEditorDatabase()
    ).get(EDITOR_STORES.detachedMaps, id);
    const parsed = DetachedHostedMapSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  public async listDetached(): Promise<readonly DetachedHostedMap[]> {
    const values: unknown[] = await (
      await openEditorDatabase()
    ).getAll(EDITOR_STORES.detachedMaps);
    return values
      .flatMap((value) => {
        const parsed = DetachedHostedMapSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      })
      .toSorted((left, right) => right.createdAt - left.createdAt);
  }
}
