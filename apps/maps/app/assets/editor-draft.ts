import { openDB, type DBSchema } from "idb";
import {
  isMapsGameProfile,
  MapDocumentSchema,
  MapSourceStateSchema,
  type MapDocument,
  type MapSourceState,
  type MapsGameProfile,
} from "@tea/maps-editor/core";

export interface EditorDraft {
  readonly documentId: string;
  readonly fileName: string;
  readonly committedSource: string;
  readonly workingSource: string;
  readonly savedSource?: string;
  readonly revision: number;
  readonly game?: MapsGameProfile;
  readonly document?: MapDocument;
  readonly sourceState?: MapSourceState;
}

export interface EditorVersion extends EditorDraft {
  readonly id: string;
  readonly createdAt: number;
  readonly label: string;
  readonly protected: boolean;
}

interface EditorDatabase extends DBSchema {
  drafts: { key: string; value: EditorDraft };
  history: {
    key: string;
    value: EditorVersion;
    indexes: { documentId: string };
  };
}

const recoveryLimit = 20;

function database() {
  return openDB<EditorDatabase>("tea-maps-editor", 2, {
    upgrade(connection) {
      if (!connection.objectStoreNames.contains("drafts"))
        connection.createObjectStore("drafts");
      const history = connection.createObjectStore("history", {
        keyPath: "id",
      });
      history.createIndex("documentId", "documentId");
    },
  });
}

function validDraft(value: unknown): value is EditorDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.documentId === "string" &&
    typeof draft.fileName === "string" &&
    typeof draft.committedSource === "string" &&
    typeof draft.workingSource === "string" &&
    (draft.savedSource === undefined ||
      typeof draft.savedSource === "string") &&
    typeof draft.revision === "number" &&
    (draft.document === undefined ||
      MapDocumentSchema.safeParse(draft.document).success) &&
    (draft.sourceState === undefined ||
      MapSourceStateSchema.safeParse(draft.sourceState).success) &&
    (draft.game === undefined || isMapsGameProfile(draft.game))
  );
}

export async function loadEditorDraft(): Promise<EditorDraft | null> {
  const connection = await database();
  try {
    const value: unknown = await connection.get("drafts", "current");
    if (validDraft(value)) return value;
    if (
      value &&
      typeof value === "object" &&
      "committedSource" in value &&
      "workingSource" in value &&
      typeof value.committedSource === "string" &&
      typeof value.workingSource === "string"
    ) {
      return {
        documentId: crypto.randomUUID(),
        fileName: "tea-map.map",
        committedSource: value.committedSource,
        workingSource: value.workingSource,
        revision: 0,
      };
    }
    return null;
  } finally {
    connection.close();
  }
}

async function prune(
  connection: Awaited<ReturnType<typeof database>>,
  documentId: string,
): Promise<void> {
  const versions = await connection.getAllFromIndex(
    "history",
    "documentId",
    documentId,
  );
  const removable = versions
    .filter((version) => !version.protected)
    .toSorted((left, right) => right.createdAt - left.createdAt);
  for (const version of removable.slice(recoveryLimit))
    await connection.delete("history", version.id);
}

export async function saveEditorDraft(draft: EditorDraft): Promise<void> {
  const connection = await database();
  try {
    const versions = await connection.getAllFromIndex(
      "history",
      "documentId",
      draft.documentId,
    );
    const latest = versions.toSorted(
      (left, right) => right.createdAt - left.createdAt,
    )[0];
    const transaction = connection.transaction(
      ["drafts", "history"],
      "readwrite",
    );
    await transaction.objectStore("drafts").put(draft, "current");
    if (
      !latest ||
      latest.committedSource !== draft.committedSource ||
      latest.workingSource !== draft.workingSource ||
      (latest.game ?? "quake") !== (draft.game ?? "quake")
    ) {
      await transaction.objectStore("history").put({
        ...draft,
        id: crypto.randomUUID(),
        createdAt: Math.max(Date.now(), (latest?.createdAt ?? 0) + 1),
        label: `Revision ${draft.revision}`,
        protected: false,
      });
    }
    await transaction.done;
    await prune(connection, draft.documentId);
  } finally {
    connection.close();
  }
}

export async function createEditorCheckpoint(
  draft: EditorDraft,
  label: string,
): Promise<EditorVersion> {
  const connection = await database();
  try {
    const versions = await connection.getAllFromIndex(
      "history",
      "documentId",
      draft.documentId,
    );
    const createdAt = versions.reduce(
      (latest, version) => Math.max(latest, version.createdAt + 1),
      Date.now(),
    );
    const version: EditorVersion = {
      ...draft,
      id: crypto.randomUUID(),
      createdAt,
      label:
        label.trim() || `Checkpoint ${new Date(createdAt).toLocaleString()}`,
      protected: true,
    };
    await connection.put("history", version);
    return version;
  } finally {
    connection.close();
  }
}

export async function listEditorVersions(): Promise<readonly EditorVersion[]> {
  const connection = await database();
  try {
    return (await connection.getAll("history")).toSorted(
      (left, right) => right.createdAt - left.createdAt,
    );
  } finally {
    connection.close();
  }
}

export async function latestEditorVersion(
  documentId: string,
): Promise<EditorVersion | null> {
  const connection = await database();
  try {
    const versions = await connection.getAllFromIndex(
      "history",
      "documentId",
      documentId,
    );
    return (
      versions.toSorted((left, right) => right.createdAt - left.createdAt)[0] ??
      null
    );
  } finally {
    connection.close();
  }
}

export async function setEditorVersionProtected(
  id: string,
  protectedVersion: boolean,
): Promise<void> {
  const connection = await database();
  try {
    const version = await connection.get("history", id);
    if (!version) return;
    await connection.put("history", {
      ...version,
      protected: protectedVersion,
    });
    if (!protectedVersion) await prune(connection, version.documentId);
  } finally {
    connection.close();
  }
}
