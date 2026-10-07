import {
  brushesInDocument,
  deriveBrush,
  deriveEditorGroups,
  deriveEditorLayers,
  materialUsageInDocument,
  planMapSave,
  pointEntitiesInDocument,
  selectedBrushIds,
  selectedPointEntityIds,
  serializeMap,
} from "@tea/maps-editor/core";
import { z } from "zod";
import {
  pagination,
  selection,
  tool,
  type EditorState,
  type JsonObject,
  type WebMcpTool,
} from "./editor-webmcp-contract.ts";

export function readEditorWebMcpTools(
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
          activeTool: current.activeTool,
          dirty: current.dirty,
          selection: selection(current),
          canUndo: current.canUndo,
          canRedo: current.canRedo,
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
                  faceIds: brush.faces.map((face) => face.id),
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
        query: z.string().max(256).default(""),
        usedOnly: z.boolean().default(false),
        ...pagination,
      }),
      {
        name: "tea_maps_list_materials",
        description:
          "List used or loaded map materials with usage counts and image dimensions.",
        execute({ query: rawQuery, usedOnly, offset, limit }) {
          const current = state();
          const usages = new Map(
            materialUsageInDocument(current.session.document).map((usage) => [
              usage.material.toLowerCase(),
              usage,
            ]),
          );
          const names = new Map<string, string>();
          for (const usage of usages.values())
            names.set(usage.material.toLowerCase(), usage.material);
          if (!usedOnly) {
            for (const material of current.materials)
              names.set(material.name.toLowerCase(), material.name);
          }
          const loaded = new Map(
            current.materials.map((material) => [
              material.name.toLowerCase(),
              material,
            ]),
          );
          const query = rawQuery.trim().toLowerCase();
          const materials = [...names].flatMap(([key, name]) => {
            const material = loaded.get(key);
            const usage = usages.get(key);
            const entry = {
              name,
              loaded: !!material,
              sourceName: material?.sourceName ?? null,
              width: material?.width ?? null,
              height: material?.height ?? null,
              faceCount: usage?.faceCount ?? 0,
              brushCount: usage?.brushCount ?? 0,
            };
            return !query || JSON.stringify(entry).toLowerCase().includes(query)
              ? [entry]
              : [];
          });
          materials.sort((left, right) => left.name.localeCompare(right.name));
          return {
            revision: current.session.document.revision,
            total: materials.length,
            offset,
            limit,
            materials: materials.slice(offset, offset + limit),
          };
        },
      },
    ),
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
