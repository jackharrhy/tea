import { describe, expect, test } from "bun:test";
import { compileWorld, SKIP_MATERIAL } from "../src";

type Point = [number, number, number];
type Transform = (point: Point) => Point;

describe("Valve geometry conformance fixtures", () => {
  test.each([
    [
      "rotated",
      ([x, y, z]: Point): Point => {
        const angle = Math.PI / 6;
        return [
          x * Math.cos(angle) - y * Math.sin(angle),
          x * Math.sin(angle) + y * Math.cos(angle),
          z,
        ];
      },
    ],
    ["sloped", ([x, y, z]: Point): Point => [x, y, z + x * 0.5]],
    ["thin", ([x, y, z]: Point): Point => [x, y, z * 0.0001]],
    [
      "negative-coordinate",
      ([x, y, z]: Point): Point => [x - 512, y - 256, z - 128],
    ],
  ] as Array<[string, Transform]>)(
    "compiles deterministic finite %s brushes",
    (_name, transform) => {
      const source = mapWithBrush(transform);
      const first = compileWorld(source, "fixture.map");
      const second = compileWorld(source, "fixture.map");
      expect(first).toEqual(second);
      expect(first.brushes[0]?.worldVertices).toHaveLength(8);
      expect(first.brushes[0]?.triangles).toHaveLength(12);
      expect(
        first.brushes[0]?.worldVertices.every((vertex) =>
          Object.values(vertex).every(Number.isFinite),
        ),
      ).toBe(true);
    },
  );

  test("emits outward triangle winding and matching normals for front-face rendering", () => {
    const brush = compileWorld(
      mapWithBrush((point) => point),
      "winding.map",
    ).brushes[0]!;
    const center = brush.worldVertices.reduce(
      (sum, vertex) => ({
        x: sum.x + vertex.x,
        y: sum.y + vertex.y,
        z: sum.z + vertex.z,
      }),
      { x: 0, y: 0, z: 0 },
    );
    center.x /= brush.worldVertices.length;
    center.y /= brush.worldVertices.length;
    center.z /= brush.worldVertices.length;

    for (const [triangleIndex, triangle] of brush.triangles.entries()) {
      const point = brush.worldVertices[triangle[0]]!;
      const normal = brush.triangleNormals[triangleIndex]!;
      const centerSide =
        normal.x * (center.x - point.x) +
        normal.y * (center.y - point.y) +
        normal.z * (center.z - point.z);
      expect(centerSide).toBeLessThan(-1e-6);
    }
  });

  test("rejects a degenerate face with complete source identity", () => {
    const source = mapWithBrush((point) => point).replace(
      "( -64 -64 -64 ) ( -64 -64 64 ) ( -64 64 64 )",
      "( 0 0 0 ) ( 1 1 1 ) ( 2 2 2 )",
    );
    expect(() => compileWorld(source, "invalid.map")).toThrow(
      /line 5, column 1, entity 0, brush 0, face 0: degenerate plane/,
    );
  });

  test("rejects a brush with one face wound against the others", () => {
    const source = mapWithBrush((point) => point).replace(
      "( -64 -64 -64 ) ( -64 -64 64 ) ( -64 64 64 )",
      "( -64 -64 -64 ) ( -64 64 64 ) ( -64 -64 64 )",
    );
    expect(() => compileWorld(source, "mixed-winding.map")).toThrow(
      /no finite convex volume|invalid face/,
    );
  });

  test("compiles a reversed-winding box whose plane points lie outside its clipped faces", () => {
    const source = `{
"classname" "worldspawn"
"mapversion" "220"
{
( -40 -24 96 ) ( -40 -23 96 ) ( -40 -24 97 ) FIXTURE [ 0 -1 0 0 ] [ 0 0 -1 0 ] 270 0.25 0.25
( -56 -8 96 ) ( -56 -8 97 ) ( -55 -8 96 ) FIXTURE [ 1 0 0 0 ] [ 0 0 -1 0 ] 270 0.25 0.25
( -56 -24 112 ) ( -55 -24 112 ) ( -56 -23 112 ) FIXTURE [ -1 0 0 0 ] [ 0 -1 0 0 ] 270 0.25 0.25
( -24 8 128 ) ( -24 9 128 ) ( -23 8 128 ) FIXTURE [ 1 0 0 0 ] [ 0 -1 0 0 ] 270 0.25 0.25
( -24 8 112 ) ( -23 8 112 ) ( -24 8 113 ) FIXTURE [ -1 0 0 0 ] [ 0 0 -1 0 ] 0 0.25 0.25
( -24 8 112 ) ( -24 8 113 ) ( -24 9 112 ) FIXTURE [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 0.25 0.25
}
}
{
"classname" "info_player_start"
"origin" "0 0 64"
}`;
    const brush = compileWorld(source, "trenchbroom-box.map").brushes[0]!;
    expect(brush.worldVertices).toHaveLength(8);
    expect(brush.triangles).toHaveLength(12);
  });

  test("applies Valve 220 scale before adding the authored texture shift", () => {
    const brush = compileWorld(
      mapWithBrush((point) => point),
      "uv.map",
    ).brushes[0]!;
    const triangleIndex = brush.triangleSourceFaces.indexOf(0);
    expect(triangleIndex).toBeGreaterThanOrEqual(0);
    const vertexIndex = brush.triangles[triangleIndex]![0]!;
    const world = brush.worldVertices[vertexIndex]!;
    const mapPoint = {
      x: world.x / 0.0254,
      y: -world.z / 0.0254,
    };
    expect(brush.triangleUvs[triangleIndex]![0]).toEqual({
      x: mapPoint.x / 0.25 + 8,
      y: mapPoint.y / 0.5 + 16,
    });
  });

  test("compiles skip faces as collision-only presentation", () => {
    const source = mapWithBrush((point) => point).replace(
      " FIXTURE [",
      ` ${SKIP_MATERIAL} [`,
    );
    const bundle = compileWorld(source, "skip.map");
    const brush = bundle.brushes[0]!;
    expect(brush.collisionOnlyFaceIndices).toEqual([0]);
    expect(brush.triangles).toHaveLength(12);
    expect(bundle.staticCollision.triangles).toHaveLength(12);
    expect(
      bundle.renderBatches.some((batch) => batch.material === SKIP_MATERIAL),
    ).toBeFalse();
    expect(
      bundle.renderBatches.reduce(
        (count, batch) => count + batch.indices.length / 3,
        0,
      ),
    ).toBe(10);
  });

  test("keeps every convex child of a multi-brush moving entity", () => {
    const source = `${mapWithBrush(([x, y, z]) => [x - 512, y - 512, z - 128])}
{
"classname" "func_physics"
"authoredId" "compound.fixture"
${brushText((point) => point)}
${brushText(([x, y, z]) => [x + 160, y, z])}
}`;
    const bundle = compileWorld(source, "compound.map");
    expect(bundle.entities[0]?.body?.brushIndices).toEqual([1, 2]);
    expect(bundle.brushes).toHaveLength(3);
    expect(
      bundle.brushes.every((brush) => brush.localVertices.length === 8),
    ).toBe(true);
  });
});

function mapWithBrush(transform: Transform): string {
  return `{
"classname" "worldspawn"
"mapversion" "220"
${brushText(transform)}
}
{
"classname" "info_player_start"
"origin" "0 0 64"
}`;
}

function brushText(transform: Transform): string {
  const p = (point: Point): string => {
    const [x, y, z] = transform(point);
    return `( ${x} ${y} ${z} )`;
  };
  const faces: Array<[Point, Point, Point]> = [
    [
      [-64, -64, -64],
      [-64, -64, 64],
      [-64, 64, 64],
    ],
    [
      [64, 64, 64],
      [64, -64, 64],
      [64, -64, -64],
    ],
    [
      [-64, -64, -64],
      [64, -64, -64],
      [64, -64, 64],
    ],
    [
      [64, 64, 64],
      [64, 64, -64],
      [-64, 64, -64],
    ],
    [
      [-64, -64, -64],
      [-64, 64, -64],
      [64, 64, -64],
    ],
    [
      [64, 64, 64],
      [-64, 64, 64],
      [-64, -64, 64],
    ],
  ];
  return `{
${faces.map(([a, b, c]) => `${p(a)} ${p(b)} ${p(c)} FIXTURE [ 1 0 0 8 ] [ 0 1 0 16 ] 0 0.25 0.5`).join("\n")}
}`;
}
