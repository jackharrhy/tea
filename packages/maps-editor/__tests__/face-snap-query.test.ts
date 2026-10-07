import { expect, it } from "vitest";
import {
  createBoxBrush,
  createEmptyDocument,
  createSequentialIdFactory,
  createBrushSelection,
  insertBrush,
  translateBrush,
  type EditorObjectViewState,
} from "../src/core/index.js";
import { FaceSnapQuery } from "../src/render/source-renderer-queries.js";
import { brushFaceHandles } from "../src/render/viewport-geometry.js";
import { faceMagnets, alignedFaces } from "../src/render/face-magnet.js";

it("queries the moving neighborhood, retains all contacts, and respects canonical changes and visibility", () => {
  const ids = createSequentialIdFactory("snap-query");
  const source = createBoxBrush([-64, -48, 0], [0, 48, 64], "SOURCE", ids);
  const first = createBoxBrush([75, -48, 0], [107, 48, 64], "TARGET", ids);
  const second = createBoxBrush([75, 48, 0], [107, 96, 64], "TARGET", ids);
  let document = createEmptyDocument();
  const world = document.entities[0]!;
  for (const brush of [
    source,
    first,
    second,
    ...Array.from({ length: 100 }, (_, i) =>
      createBoxBrush(
        [1000 + i * 64, 1000, 0],
        [1032 + i * 64, 1032, 64],
        "FAR",
        ids,
      ),
    ),
  ])
    document = insertBrush(document, world.id, brush);
  const selection = createBrushSelection([source.id]);
  const view: EditorObjectViewState = {
    hiddenBrushIds: [],
    hiddenEntityIds: [],
    lockedBrushIds: [],
    lockedEntityIds: [],
  };
  const sourceFace = brushFaceHandles(source).find(
    (face) => face.normal[0] > 0.99,
  )!;
  const query = new FaceSnapQuery();
  expect(query.query(document, selection, view, sourceFace, 0, 1)).toEqual([]);
  const nearby = query.query(document, selection, view, sourceFace, 75, 1);
  expect(new Set(nearby.map((face) => face.selection.brushId))).toEqual(
    new Set([first.id, second.id]),
  );
  const aligned = alignedFaces(75, 1, faceMagnets(sourceFace, nearby));
  expect(aligned).toHaveLength(2);
  expect(query.query(document, selection, view, sourceFace, 75, 1)[0]).toBe(
    nearby[0],
  );
  const hidden = query.query(
    document,
    selection,
    { ...view, hiddenBrushIds: [second.id] },
    sourceFace,
    75,
    1,
  );
  expect(alignedFaces(75, 1, faceMagnets(sourceFace, hidden))).toHaveLength(1);
  expect(
    query.query(
      document,
      selection,
      { ...view, hiddenEntityIds: [world.id] },
      sourceFace,
      75,
      1,
    ),
  ).toEqual([]);
  const moved = {
    ...document,
    revision: document.revision + 1,
    entities: [
      {
        ...document.entities[0]!,
        primitives: [source, translateBrush(first, [100, 0, 0])],
      },
    ],
  };
  expect(query.query(moved, selection, view, sourceFace, 75, 1)).toEqual([]);
  expect(
    alignedFaces(
      75,
      1,
      faceMagnets(
        sourceFace,
        query.query(document, selection, view, sourceFace, 75, 1),
      ),
    ),
  ).toHaveLength(2);
});
