import { describe, expect, it } from "vitest";

import {
  BoundsSpatialIndex,
  EditorSession,
  brushesInDocument,
  createBoxBrush,
  createSequentialIdFactory,
  createStarterDocument,
  deriveBrush,
  parseMapSource,
  serializeMap,
  type MapDocument,
} from "../src/core/index.js";

const BRUSH_COUNT = 8_000;
const LOAD_LIMIT_MS = 3_000;
const COMMIT_LIMIT_MS = 100;

function benchmarkDocument(): MapDocument {
  const ids = createSequentialIdFactory("scale-benchmark");
  const starter = createStarterDocument();
  const brushes = Array.from({ length: BRUSH_COUNT }, (_, index) => {
    const x = (index % 100) * 48;
    const y = Math.floor(index / 100) * 48;
    return createBoxBrush([x, y, 0], [x + 32, y + 32, 32], "BENCHMARK", ids);
  });
  return {
    ...starter,
    entities: [
      { ...starter.entities[0]!, primitives: brushes },
      ...starter.entities.slice(1),
    ],
  };
}

function elapsed(action: () => void): number {
  const start = performance.now();
  action();
  return performance.now() - start;
}

describe("8,000-brush dependable-solo envelope", () => {
  it("loads, indexes, translates, changes material, and undoes within the CPU budgets", () => {
    const source = serializeMap(benchmarkDocument());
    let parsed!: ReturnType<typeof parseMapSource>;
    let session!: EditorSession;
    let index!: BoundsSpatialIndex<string>;
    const loadMilliseconds = elapsed(() => {
      parsed = parseMapSource(source);
      session = new EditorSession(parsed.document);
      index = new BoundsSpatialIndex(
        brushesInDocument(parsed.document).flatMap((brush) => {
          const bounds = deriveBrush(brush).bounds;
          return bounds ? [{ bounds, value: brush.id }] : [];
        }),
      );
    });
    const target = brushesInDocument(session.document)[0]!;
    session.selectBrush(target.id);
    const translateMilliseconds = elapsed(() =>
      session.translate(target.id, [16, 0, 0]),
    );
    const materialMilliseconds = elapsed(() =>
      session.applyMaterial("BENCHMARK_CHANGED"),
    );
    const undoMilliseconds = elapsed(() => session.undo());

    expect(index.size).toBe(BRUSH_COUNT);
    expect(index.queryRay([-16, 16, 16], [1, 0, 0]).length).toBeGreaterThan(0);
    expect(loadMilliseconds).toBeLessThan(LOAD_LIMIT_MS);
    expect(translateMilliseconds).toBeLessThan(COMMIT_LIMIT_MS);
    expect(materialMilliseconds).toBeLessThan(COMMIT_LIMIT_MS);
    expect(undoMilliseconds).toBeLessThan(COMMIT_LIMIT_MS);
  }, 15_000);
});
