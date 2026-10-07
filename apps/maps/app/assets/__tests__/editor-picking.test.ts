import { expect, it } from "vitest";
import {
  createBoxBrush,
  createSequentialIdFactory,
  createStarterDocument,
  EditorSession,
  selectedBrushIds,
  selectedFaceReferences,
} from "@tea/maps-editor/core";
import { applyViewportPick } from "../editor-picking.ts";

const singlePick = { additive: false, expansion: "single" } as const;

it("picks closed groups as a unit and opens one on activation", () => {
  const ids = createSequentialIdFactory("tea-pick-group");
  const grouped = createBoxBrush([0, 0, 0], [16, 16, 16], "STONE", ids);
  const outside = createBoxBrush([32, 0, 0], [48, 16, 16], "STONE", ids);
  const starter = createStarterDocument();
  const session = new EditorSession({
    ...starter,
    entities: [{ ...starter.entities[0]!, primitives: [grouped, outside] }],
  });
  session.selectBrush(grouped.id);
  const groupId = session.groupSelected("Picked group", ids)!;
  session.selectBrush(outside.id);

  applyViewportPick({
    session,
    selection: { brushId: grouped.id },
    intent: { ...singlePick, objectAdditive: true },
    openGroupId: null,
    activeTool: "select",
  });
  expect(selectedBrushIds(session.selection)).toEqual([outside.id, grouped.id]);
  applyViewportPick({
    session,
    selection: { brushId: grouped.id },
    intent: { ...singlePick, objectAdditive: true },
    openGroupId: null,
    activeTool: "select",
  });
  expect(selectedBrushIds(session.selection)).toEqual([outside.id]);

  const activated = applyViewportPick({
    session,
    selection: { brushId: grouped.id },
    intent: { ...singlePick, objectExpansion: "activate" },
    openGroupId: null,
    activeTool: "select",
  });
  expect(activated.kind).toBe("open-group");
  if (activated.kind !== "open-group") return;
  expect(activated.group.id).toBe(groupId);
  session.setEditingGroup(groupId);
  applyViewportPick({
    session,
    selection: { brushId: grouped.id },
    intent: singlePick,
    openGroupId: groupId,
    activeTool: "select",
  });
  expect(session.selection?.groupId).toBeUndefined();
  expect(selectedBrushIds(session.selection)).toEqual([grouped.id]);
});

it("expands a brush entity pick to its sibling brushes", () => {
  const ids = createSequentialIdFactory("tea-pick-siblings");
  const first = createBoxBrush([0, 0, 0], [16, 16, 16], "STONE", ids);
  const second = createBoxBrush([32, 0, 0], [48, 16, 16], "STONE", ids);
  const starter = createStarterDocument();
  const session = new EditorSession({
    ...starter,
    entities: [
      { ...starter.entities[0]!, primitives: [] },
      {
        id: ids.entity(),
        properties: { classname: "func_detail" },
        primitives: [first, second],
      },
    ],
  });

  applyViewportPick({
    session,
    selection: { brushId: first.id },
    intent: { ...singlePick, objectExpansion: "siblings" },
    openGroupId: null,
    activeTool: "select",
  });
  expect(selectedBrushIds(session.selection)).toEqual([first.id, second.id]);
});

it("selects matching faces across a multi-brush object selection", () => {
  const ids = createSequentialIdFactory("tea-pick-matching-faces");
  const left = createBoxBrush([-32, -32, 0], [0, 32, 32], "LEFT", ids);
  const right = createBoxBrush([0, -32, 0], [32, 32, 32], "RIGHT", ids);
  const starter = createStarterDocument();
  const session = new EditorSession({
    ...starter,
    entities: [{ ...starter.entities[0]!, primitives: [left, right] }],
  });
  session.selectBrush(left.id);
  session.selectBrush(right.id, true);

  applyViewportPick({
    session,
    selection: { brushId: left.id, faceId: left.faces[0]!.id },
    intent: singlePick,
    openGroupId: null,
    activeTool: "face",
  });
  expect(selectedFaceReferences(session.selection)).toEqual([
    { brushId: left.id, faceId: left.faces[0]!.id },
    { brushId: right.id, faceId: right.faces[1]!.id },
  ]);
});
