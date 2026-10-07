import {
  DocumentIdSchema,
  selectedBrushIds,
  selectedFaceReferences,
  selectedPointEntityIds,
  type EditorSession,
  type EditorMaterial,
  type MapSourceState,
} from "@tea/maps-editor/core";
import type { EditorSourceRenderer } from "@tea/maps-editor/render";
import type { HostedMapLaunch } from "@tea/maps-protocol";
import { z } from "zod";
import type { MapProject } from "./editor-project.ts";

export type JsonObject = Readonly<Record<string, unknown>>;

export interface WebMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly annotations: Readonly<{
    readOnlyHint: boolean;
    idempotentHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint: false;
  }>;
  execute(input: unknown): JsonObject | Promise<JsonObject>;
}

export interface WebMcpModelContext {
  registerTool(
    tool: WebMcpTool,
    options: { readonly signal: AbortSignal },
  ): void | Promise<void>;
}

export interface EditorState {
  readonly session: EditorSession;
  readonly name: string;
  readonly workingSource: string;
  readonly sourceState: MapSourceState;
  readonly dirty: boolean;
  readonly project: MapProject | null;
  readonly hostedMap: HostedMapLaunch | null;
  readonly renderer: EditorSourceRenderer | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly materials: readonly EditorMaterial[];
  readonly activeTool: string;
}

export interface EditorActions {
  prepareEdit(): void;
  history(action: "undo" | "redo"): Promise<void>;
  openProjectMap(
    path: string,
    discardUnsavedChanges: boolean,
    expectedDocumentId: string,
    expectedRevision: number,
  ): Promise<void>;
  replaceMapSource(
    source: string,
    name: string,
    expectedDocumentId: string,
    expectedRevision: number,
  ): Promise<void>;
  setTool(tool: string): void;
  status(message: string): void;
}

export const pagination = {
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(50),
};
const readOnly = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;
export const changesView = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;
export const destructive = { ...changesView, destructiveHint: true } as const;
export const expectedDocument = {
  expectedDocumentId: DocumentIdSchema,
  expectedRevision: z.number().int().nonnegative(),
};
export const axis = z.enum(["x", "y", "z"]);

export function axisIndex(value: "x" | "y" | "z"): 0 | 1 | 2 {
  return value === "x" ? 0 : value === "y" ? 1 : 2;
}

export function tool<Schema extends z.ZodType>(
  schema: Schema,
  definition: {
    readonly name: string;
    readonly description: string;
    readonly annotations?: WebMcpTool["annotations"];
    execute(input: z.output<Schema>): JsonObject | Promise<JsonObject>;
  },
): WebMcpTool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: z.toJSONSchema(schema) as JsonObject,
    annotations: definition.annotations ?? readOnly,
    execute(input) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        const path = issue.path.length ? ` at ${issue.path.join(".")}` : "";
        throw new Error(`Tool input is invalid${path}: ${issue.message}`);
      }
      return definition.execute(parsed.data);
    },
  };
}

export function selection(state: EditorState) {
  const value = state.session.selection;
  return {
    kind: !value ? "none" : value.faceId ? "faces" : "objects",
    brushIds: selectedBrushIds(value),
    entityIds: selectedPointEntityIds(value),
    faces: selectedFaceReferences(value),
    groupId: value?.groupId ?? null,
  };
}

export function assertDocument(
  state: () => EditorState,
  input: { expectedDocumentId: string; expectedRevision: number },
): EditorState {
  const current = state();
  const document = current.session.document;
  if (document.id !== input.expectedDocumentId)
    throw new Error(`Stale document identity: current ID is ${document.id}`);
  if (document.revision !== input.expectedRevision)
    throw new Error(
      `Stale document revision: current revision is ${document.revision}`,
    );
  return current;
}
