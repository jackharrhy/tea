import {
  brushesInDocument,
  deriveBrush,
  deriveEditorGroups,
  deriveEditorLayers,
  materialUsageInDocument,
  planMapSave,
  pointEntitiesInDocument,
  selectedBrushIds,
  selectedFaceReferences,
  selectedPointEntityIds,
  serializeMap,
  type EditorSession,
  type MapSourceState,
} from "@tea/maps-editor/core";
import type { EditorSourceRenderer } from "@tea/maps-editor/render";
import type { HostedMapLaunch } from "@tea/maps-protocol";
import { z } from "zod";
import type { MapProject } from "./editor-project.ts";

type JsonObject = Readonly<Record<string, unknown>>;

interface WebMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly annotations: Readonly<{
    readOnlyHint: true;
    idempotentHint: true;
    openWorldHint: false;
  }>;
  execute(input: unknown): JsonObject;
}

interface WebMcpModelContext {
  registerTool(
    tool: WebMcpTool,
    options: { readonly signal: AbortSignal },
  ): void | Promise<void>;
}

interface EditorState {
  readonly session: EditorSession;
  readonly name: string;
  readonly workingSource: string;
  readonly sourceState: MapSourceState;
  readonly dirty: boolean;
  readonly project: MapProject | null;
  readonly hostedMap: HostedMapLaunch | null;
  readonly renderer: EditorSourceRenderer | null;
}

const pagination = {
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(50),
};
const readOnly = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function tool<Schema extends z.ZodType>(
  schema: Schema,
  definition: {
    readonly name: string;
    readonly description: string;
    execute(input: z.output<Schema>): JsonObject;
  },
): WebMcpTool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: z.toJSONSchema(schema) as JsonObject,
    annotations: readOnly,
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

function selection(state: EditorState) {
  const value = state.session.selection;
  return {
    kind: !value ? "none" : value.faceId ? "faces" : "objects",
    brushIds: selectedBrushIds(value),
    entityIds: selectedPointEntityIds(value),
    faces: selectedFaceReferences(value),
    groupId: value?.groupId ?? null,
  };
}

export function editorWebMcpTools(
  state: () => EditorState,
): readonly WebMcpTool[] {
  return [
    tool(z.strictObject({}), {
      name: "tea_maps_inspect_editor",
      description:
        "Inspect the live Tea Maps document, selection, project, source-save safety, and perspective camera.",
      execute() {
        const current = state();
        const document = current.session.document;
        const brushes = brushesInDocument(document);
        const issues = current.session.issues;
        const save = planMapSave(document, current.sourceState);
        return {
          documentId: document.id,
          name: current.name,
          revision: document.revision,
          format: document.faceSyntax,
          dirty: current.dirty,
          selection: selection(current),
          canUndo: current.session.canUndo,
          canRedo: current.session.canRedo,
          counts: {
            entities: document.entities.length,
            pointEntities: pointEntitiesInDocument(document).length,
            brushes: brushes.length,
            faces: brushes.reduce((sum, brush) => sum + brush.faces.length, 0),
            groups: deriveEditorGroups(document).length,
            layers: deriveEditorLayers(document).length,
            issues: issues.length,
            materialsInMap: materialUsageInDocument(document).length,
          },
          sourceSave: {
            status: save.status,
            fingerprint: current.sourceState.fingerprint,
            diagnostics: save.diagnostics,
            hasUnappliedText:
              current.workingSource !==
              (save.status === "safe" ? save.text : save.normalizedText),
          },
          project: current.project
            ? {
                name: current.project.manifest.name,
                game: current.project.manifest.game,
                maps: current.project.maps.length,
              }
            : null,
          hostedMap: current.hostedMap
            ? {
                id: current.hostedMap.id,
                projectId: current.hostedMap.projectId,
                mapVersion: current.hostedMap.mapVersion,
                role: current.hostedMap.role,
              }
            : null,
          perspectiveCamera:
            current.renderer?.viewportCamera("perspective") ?? null,
        };
      },
    }),
    tool(
      z.strictObject({
        kind: z.enum(["all", "brush", "entity"]).default("all"),
        query: z.string().max(256).default(""),
        ...pagination,
      }),
      {
        name: "tea_maps_list_objects",
        description:
          "List live brush and entity IDs with geometry, ownership, materials, and properties for inspection.",
        execute({ kind, query: rawQuery, offset, limit }) {
          const current = state();
          const document = current.session.document;
          const selectedBrushes = new Set(
            selectedBrushIds(current.session.selection),
          );
          const selectedEntities = new Set(
            selectedPointEntityIds(current.session.selection),
          );
          const objects: JsonObject[] = [];
          if (kind !== "entity") {
            for (const entity of document.entities) {
              for (const brush of entity.primitives) {
                if (brush.kind !== "brush") continue;
                const derived = deriveBrush(brush);
                objects.push({
                  kind: "brush",
                  id: brush.id,
                  selected: selectedBrushes.has(brush.id),
                  ownerEntityId: entity.id,
                  faceCount: brush.faces.length,
                  materials: [
                    ...new Set(brush.faces.map((face) => face.material)),
                  ].toSorted(),
                  bounds: derived.bounds,
                  valid: derived.valid,
                });
              }
            }
          }
          if (kind !== "brush") {
            for (const entity of document.entities) {
              objects.push({
                kind: "entity",
                id: entity.id,
                selected: selectedEntities.has(entity.id),
                classname: entity.properties.classname ?? "",
                brushCount: entity.primitives.length,
                properties: entity.properties,
              });
            }
          }
          const query = rawQuery.trim().toLowerCase();
          const filtered = query
            ? objects.filter((object) =>
                JSON.stringify(object).toLowerCase().includes(query),
              )
            : objects;
          return {
            revision: document.revision,
            total: filtered.length,
            offset,
            limit,
            objects: filtered.slice(offset, offset + limit),
          };
        },
      },
    ),
    tool(z.strictObject(pagination), {
      name: "tea_maps_list_issues",
      description:
        "List bounded live map diagnostics and implicated object IDs.",
      execute({ offset, limit }) {
        const current = state();
        const issues = current.session.issues;
        return {
          revision: current.session.document.revision,
          total: issues.length,
          offset,
          limit,
          issues: issues.slice(offset, offset + limit).map((issue) => ({
            id: issue.id,
            type: issue.type,
            category: issue.category,
            severity: issue.severity,
            message: issue.message,
            brushIds: issue.brushIds,
            entityIds: issue.entityIds,
            fixLabel: issue.fix?.label ?? null,
          })),
        };
      },
    }),
    tool(
      z.strictObject({
        mode: z.enum(["save", "original", "normalized"]).default("save"),
        offset: z.number().int().nonnegative().default(0),
        maxChars: z.number().int().min(1).max(100_000).default(20_000),
      }),
      {
        name: "tea_maps_get_map_source",
        description:
          "Read a bounded source-preserving save slice, original source, or normalized map copy.",
        execute({ mode, offset, maxChars }) {
          const current = state();
          const document = current.session.document;
          const save = planMapSave(document, current.sourceState);
          const source =
            mode === "original"
              ? current.sourceState.originalText
              : mode === "normalized"
                ? serializeMap(document)
                : save.status === "safe"
                  ? save.text
                  : null;
          return {
            revision: document.revision,
            mode,
            saveStatus: save.status,
            diagnostics: save.diagnostics,
            offset,
            totalChars: source?.length ?? null,
            truncated: source ? offset + maxChars < source.length : false,
            text: source?.slice(offset, offset + maxChars) ?? null,
          };
        },
      },
    ),
  ];
}

export async function registerEditorWebMcpTools(
  document: Document,
  state: () => EditorState,
): Promise<void> {
  const root = document.documentElement;
  const modelContext = (
    document as Document & { readonly modelContext?: WebMcpModelContext }
  ).modelContext;
  if (!modelContext?.registerTool) {
    root.dataset.teaMapsSiteTools = "unsupported";
    return;
  }
  const controller = new AbortController();
  window.addEventListener("pagehide", () => controller.abort(), { once: true });
  const tools = editorWebMcpTools(state);
  const registrations = await Promise.allSettled(
    tools.map((entry) =>
      modelContext.registerTool(entry, { signal: controller.signal }),
    ),
  );
  root.dataset.teaMapsSiteToolCount = String(
    registrations.filter((result) => result.status === "fulfilled").length,
  );
  root.dataset.teaMapsSiteTools = registrations.some(
    (result) => result.status === "rejected",
  )
    ? "error"
    : "ready";
}
