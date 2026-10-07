import {
  BrushIdSchema,
  EntityIdSchema,
  FaceIdSchema,
  createBoxBrush,
  createFaceSelection,
  createObjectSelection,
  createSequentialIdFactory,
  findBrush,
  pointEntitiesInDocument,
  Vec3Schema,
} from "@tea/maps-editor/core";
import { z } from "zod";
import {
  assertDocument,
  axis,
  axisIndex,
  changesView,
  destructive,
  expectedDocument,
  selection,
  tool,
  type EditorActions,
  type EditorState,
  type WebMcpTool,
} from "./editor-webmcp-contract.ts";

export function editEditorWebMcpTools(
  state: () => EditorState,
  actions: EditorActions,
): readonly WebMcpTool[] {
  const assertCurrentDocument = (input: {
    expectedDocumentId: string;
    expectedRevision: number;
  }) => assertDocument(state, input);
  return [
    tool(z.strictObject({ target: z.enum(["document", "selection"]) }), {
      name: "tea_maps_frame_view",
      description:
        "Frame the document or current selection in the visible editor viewports.",
      annotations: { ...changesView, idempotentHint: true },
      execute({ target }) {
        const current = state();
        const framed =
          target === "document"
            ? current.renderer?.focusDocument()
            : current.renderer?.focusSelection();
        if (!framed) throw new Error(`Cannot frame ${target}`);
        actions.status(`framed the ${target}`);
        return {
          revision: current.session.document.revision,
          target,
          perspectiveCamera:
            current.renderer?.viewportCamera("perspective") ?? null,
        };
      },
    }),
    tool(
      z.strictObject({
        tool: z.enum([
          "select",
          "entity",
          "create",
          "hull",
          "face",
          "sweep",
          "clip",
          "vertex",
          "edge",
          "rotate",
          "scale",
          "shear",
        ]),
      }),
      {
        name: "tea_maps_set_tool",
        description: "Activate one of the visible Maps viewport editing tools.",
        annotations: changesView,
        execute({ tool: next }) {
          actions.setTool(next);
          actions.status(`activated the ${next} tool`);
          const current = state();
          return {
            revision: current.session.document.revision,
            activeTool: current.activeTool,
            selection: selection(current),
          };
        },
      },
    ),
    tool(
      z.discriminatedUnion("mode", [
        z.strictObject({ ...expectedDocument, mode: z.literal("clear") }),
        z.strictObject({ ...expectedDocument, mode: z.literal("all") }),
        z.strictObject({ ...expectedDocument, mode: z.literal("invert") }),
        z.strictObject({
          ...expectedDocument,
          mode: z.literal("objects"),
          brushIds: z.array(BrushIdSchema).max(1_024).default([]),
          entityIds: z.array(EntityIdSchema).max(1_024).default([]),
        }),
        z.strictObject({
          ...expectedDocument,
          mode: z.literal("faces"),
          faces: z
            .array(
              z.strictObject({
                brushId: BrushIdSchema,
                faceId: FaceIdSchema,
              }),
            )
            .min(1)
            .max(1_024),
        }),
        z.strictObject({
          ...expectedDocument,
          mode: z.literal("issue"),
          issueId: z.string().min(1).max(512),
        }),
        z.strictObject({
          ...expectedDocument,
          mode: z.enum(["material-faces", "material-brushes"]),
          material: z.string().trim().min(1).max(256),
        }),
      ]),
      {
        name: "tea_maps_select",
        description:
          "Select live objects, faces, issues, or material uses; select all, invert, or clear the selection.",
        annotations: changesView,
        execute(input) {
          const current = assertCurrentDocument(input);
          if (input.mode === "clear") current.session.select(null);
          else if (input.mode === "all") current.session.selectAllEditable();
          else if (input.mode === "invert")
            current.session.invertObjectSelection();
          else if (input.mode === "issue") {
            if (!current.session.selectIssue(input.issueId))
              throw new Error(`Unknown or empty issue ${input.issueId}`);
          } else if (input.mode === "material-faces")
            current.session.selectFacesUsingMaterial(input.material);
          else if (input.mode === "material-brushes")
            current.session.selectBrushesUsingMaterial(input.material);
          else if (input.mode === "faces") {
            for (const face of input.faces) {
              const brush = findBrush(current.session.document, face.brushId);
              if (
                !brush?.faces.some((candidate) => candidate.id === face.faceId)
              )
                throw new Error(`Unknown face ${face.brushId}/${face.faceId}`);
            }
            current.session.select(createFaceSelection(input.faces));
          } else if (input.mode === "objects") {
            const brushIds = [...new Set(input.brushIds)];
            const entityIds = [...new Set(input.entityIds)];
            for (const id of brushIds) {
              if (!findBrush(current.session.document, id))
                throw new Error(`Unknown brush ${id}`);
            }
            const pointIds = new Set(
              pointEntitiesInDocument(current.session.document).map(
                (entity) => entity.id,
              ),
            );
            for (const id of entityIds) {
              if (!pointIds.has(id))
                throw new Error(`Unknown point entity ${id}`);
            }
            current.session.select(createObjectSelection(brushIds, entityIds));
          }
          actions.status("updated the selection");
          return {
            revision: current.session.document.revision,
            selection: selection(current),
          };
        },
      },
    ),
    tool(
      z.strictObject({
        ...expectedDocument,
        delta: Vec3Schema,
        textureLock: z.boolean().default(true),
      }),
      {
        name: "tea_maps_translate_selection",
        description:
          "Move selected brushes and point entities as one undoable editor transaction.",
        annotations: changesView,
        execute(input) {
          const current = assertCurrentDocument(input);
          actions.prepareEdit();
          if (
            !current.session.translateSelected(input.delta, input.textureLock)
          )
            throw new Error(
              "The requested translation did not change the document",
            );
          actions.status("translated the selection");
          return {
            documentId: current.session.document.id,
            revision: current.session.document.revision,
            selection: selection(current),
          };
        },
      },
    ),
    tool(
      z.strictObject({
        ...expectedDocument,
        pivot: Vec3Schema,
        axis,
        degrees: z.number().finite(),
        textureLock: z.boolean().default(true),
      }),
      {
        name: "tea_maps_rotate_selection",
        description:
          "Rotate selected brushes and point entities around a pivot as one undoable edit.",
        annotations: changesView,
        execute(input) {
          const current = assertCurrentDocument(input);
          actions.prepareEdit();
          if (
            !current.session.rotateSelected(
              input.pivot,
              axisIndex(input.axis),
              input.degrees,
              input.textureLock,
            )
          )
            throw new Error(
              "The requested rotation did not change the document",
            );
          actions.status("rotated the selection");
          return {
            documentId: current.session.document.id,
            revision: current.session.document.revision,
            selection: selection(current),
          };
        },
      },
    ),
    tool(
      z.strictObject({
        ...expectedDocument,
        pivot: Vec3Schema,
        factors: Vec3Schema,
        textureLock: z.boolean().default(true),
      }),
      {
        name: "tea_maps_scale_selection",
        description:
          "Scale selected brushes and point entities around a pivot as one undoable edit.",
        annotations: changesView,
        execute(input) {
          const current = assertCurrentDocument(input);
          actions.prepareEdit();
          if (
            !current.session.scaleSelected(
              input.pivot,
              input.factors,
              input.textureLock,
            )
          )
            throw new Error("The requested scale did not change the document");
          actions.status("scaled the selection");
          return {
            documentId: current.session.document.id,
            revision: current.session.document.revision,
            selection: selection(current),
          };
        },
      },
    ),
    tool(
      z.strictObject({
        ...expectedDocument,
        pivot: Vec3Schema,
        sourceAxis: axis,
        targetAxis: axis,
        factor: z.number().finite(),
        textureLock: z.boolean().default(true),
      }),
      {
        name: "tea_maps_shear_selection",
        description:
          "Shear selected brushes and point entities around a pivot as one undoable edit.",
        annotations: changesView,
        execute(input) {
          const current = assertCurrentDocument(input);
          actions.prepareEdit();
          const sourceAxis = axisIndex(input.sourceAxis);
          const targetAxis = axisIndex(input.targetAxis);
          if (sourceAxis === targetAxis)
            throw new Error("sourceAxis and targetAxis must differ");
          if (
            !current.session.shearSelected(
              input.pivot,
              sourceAxis,
              targetAxis,
              input.factor,
              input.textureLock,
            )
          )
            throw new Error("The requested shear did not change the document");
          actions.status("sheared the selection");
          return {
            documentId: current.session.document.id,
            revision: current.session.document.revision,
            selection: selection(current),
          };
        },
      },
    ),
    tool(
      z.strictObject({
        ...expectedDocument,
        min: Vec3Schema,
        max: Vec3Schema,
        material: z.string().trim().min(1).max(256),
      }),
      {
        name: "tea_maps_create_box",
        description:
          "Create and select a six-face box brush as one undoable editor transaction.",
        annotations: changesView,
        execute(input) {
          const current = assertCurrentDocument(input);
          actions.prepareEdit();
          if (input.min.some((value, index) => value >= input.max[index]!))
            throw new Error("max must be greater than min on every axis");
          const brush = createBoxBrush(
            input.min,
            input.max,
            input.material,
            createSequentialIdFactory(`tea-site-tool-${crypto.randomUUID()}`),
          );
          current.session.commitCreationCandidate(
            current.session.createBrushCandidate(brush),
          );
          actions.status(`created brush ${brush.id}`);
          return {
            documentId: current.session.document.id,
            revision: current.session.document.revision,
            brushId: brush.id,
            selection: selection(current),
          };
        },
      },
    ),
    tool(
      z.strictObject({
        ...expectedDocument,
        classname: z.string().trim().min(1).max(256),
        origin: Vec3Schema,
        properties: z
          .record(z.string().max(256), z.string().max(16_384))
          .refine((properties) => Object.keys(properties).length <= 128)
          .default({}),
      }),
      {
        name: "tea_maps_create_point_entity",
        description:
          "Create and select a point entity with raw properties as one undoable editor transaction.",
        annotations: changesView,
        execute(input) {
          const current = assertCurrentDocument(input);
          actions.prepareEdit();
          current.session.createPointEntity(
            input.classname,
            input.origin,
            createSequentialIdFactory(`tea-site-tool-${crypto.randomUUID()}`),
            input.properties,
          );
          actions.status(`created ${input.classname}`);
          return {
            documentId: current.session.document.id,
            revision: current.session.document.revision,
            entityId: current.session.selection?.entityId ?? null,
            selection: selection(current),
          };
        },
      },
    ),
    tool(
      z.strictObject({
        ...expectedDocument,
        material: z.string().trim().min(1).max(256),
      }),
      {
        name: "tea_maps_apply_material",
        description:
          "Apply a material to the selected brushes or faces as one undoable editor transaction.",
        annotations: changesView,
        execute(input) {
          const current = assertCurrentDocument(input);
          actions.prepareEdit();
          if (!current.session.applyMaterial(input.material))
            throw new Error(
              "The requested material change did not edit the document",
            );
          actions.status(`applied material ${input.material}`);
          return {
            documentId: current.session.document.id,
            revision: current.session.document.revision,
            selection: selection(current),
          };
        },
      },
    ),
    tool(
      z.strictObject({
        ...expectedDocument,
        entityId: EntityIdSchema,
        key: z.string().trim().min(1).max(256),
        value: z.string().max(16_384).nullable(),
        protect: z.boolean().default(false),
      }),
      {
        name: "tea_maps_edit_entity_property",
        description:
          "Add, update, or remove one raw entity property as an undoable editor transaction.",
        annotations: changesView,
        execute(input) {
          const current = assertCurrentDocument(input);
          actions.prepareEdit();
          if (
            !current.session.setEntityProperty(
              input.entityId,
              input.key,
              input.value,
              input.protect,
            )
          )
            throw new Error(
              "The requested property change did not edit the document",
            );
          actions.status(`updated entity property ${input.key}`);
          return {
            documentId: current.session.document.id,
            revision: current.session.document.revision,
          };
        },
      },
    ),
    tool(
      z.strictObject({
        ...expectedDocument,
        delta: Vec3Schema,
        textureLock: z.boolean().default(true),
      }),
      {
        name: "tea_maps_duplicate_selection",
        description:
          "Duplicate selected objects with an offset as one undoable editor transaction.",
        annotations: changesView,
        execute(input) {
          const current = assertCurrentDocument(input);
          actions.prepareEdit();
          if (
            !current.session.duplicateSelected(
              createSequentialIdFactory(`tea-site-tool-${crypto.randomUUID()}`),
              input.delta,
              input.textureLock,
            )
          )
            throw new Error("The selected objects could not be duplicated");
          actions.status("duplicated the selection");
          return {
            documentId: current.session.document.id,
            revision: current.session.document.revision,
            selection: selection(current),
          };
        },
      },
    ),
    tool(z.strictObject(expectedDocument), {
      name: "tea_maps_delete_selection",
      description:
        "Delete selected objects as one undoable editor transaction.",
      annotations: destructive,
      execute(input) {
        const current = assertCurrentDocument(input);
        actions.prepareEdit();
        if (!current.session.deleteSelected())
          throw new Error("The selected objects could not be deleted");
        actions.status("deleted the selection");
        return {
          documentId: current.session.document.id,
          revision: current.session.document.revision,
        };
      },
    }),
    tool(
      z.strictObject({
        ...expectedDocument,
        action: z.enum(["undo", "redo"]),
      }),
      {
        name: "tea_maps_history",
        description:
          "Undo or redo one live editor transaction, including personalized hosted history.",
        annotations: changesView,
        async execute(input) {
          const current = assertCurrentDocument(input);
          actions.prepareEdit();
          if (input.action === "undo" ? !current.canUndo : !current.canRedo)
            throw new Error(`Nothing to ${input.action}`);
          await actions.history(input.action);
          actions.status(`${input.action} completed`);
          const updated = state();
          return {
            documentId: updated.session.document.id,
            revision: updated.session.document.revision,
            selection: selection(updated),
          };
        },
      },
    ),
  ];
}
