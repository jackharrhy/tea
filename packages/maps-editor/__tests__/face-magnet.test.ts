import { expect, it } from "vitest";
import { PrimitiveIdSchema, FaceIdSchema } from "../src/core/index.js";
import { faceMagnets, pickFaceMagnet } from "../src/render/face-magnet.js";
import type { FaceHandle } from "../src/render/viewport-geometry.js";
const face = (x: number, y = 0): FaceHandle => ({
  selection: {
    brushId: PrimitiveIdSchema.parse(`b${x}`),
    faceId: FaceIdSchema.parse("f"),
  },
  center: [x, y, 16],
  normal: [1, 0, 0],
  vertices: [
    [x, y - 16, 0],
    [x, y + 16, 0],
    [x, y + 16, 32],
    [x, y - 16, 32],
  ],
});
it("attracts to off-grid parallel faces with overlapping footprints and releases beyond the threshold", () => {
  const candidates = faceMagnets(face(0), [face(43), face(60, 100)]);
  expect(candidates.map((c) => c.distance)).toEqual([43]);
  const snap = pickFaceMagnet(40, 2, candidates, null);
  expect(snap?.distance).toBe(43);
  expect(pickFaceMagnet(49, 2, candidates, snap)).toBe(snap);
  expect(pickFaceMagnet(51, 2, candidates, snap)).toBeNull();
  expect(pickFaceMagnet(80, 2, candidates, null)).toBeNull();
});

it("accepts edge-touching side faces while rejecting a gap between footprints", () => {
  expect(
    faceMagnets(face(0), [face(43, 32), face(60, 33)]).map(
      (candidate) => candidate.distance,
    ),
  ).toEqual([43]);
  const platform = {
    ...face(75),
    center: [75, 0, -8] as const,
    vertices: [
      [75, -64, -16],
      [75, 64, -16],
      [75, 64, 0],
      [75, -64, 0],
    ] as const,
  };
  expect(
    faceMagnets(face(0), [platform]).map((candidate) => candidate.distance),
  ).toEqual([75]);
});

it("keeps original alignment eligible when a drag returns to zero displacement", () => {
  const candidates = faceMagnets(face(0), [face(0, 32), face(43)]);
  expect(candidates.map((candidate) => candidate.distance)).toEqual([0, 43]);
  expect(pickFaceMagnet(25, 2, candidates, null)).toBeNull();
  expect(pickFaceMagnet(0, 2, candidates, null)?.distance).toBe(0);
});
