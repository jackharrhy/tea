import { describe, expect, test } from "bun:test";
import {
  compileWorld,
  decodeWorldBundle,
  encodeWorldBundle,
  entityDefinitions,
  SKIP_MATERIAL,
  type EntityClassname,
} from "@harrhy/gurgur-game";
import { MATERIAL_TEXTURE_SIZE, parseValve220 } from "@harrhy/gurgur-engine";

const source = await Bun.file(
  new URL("../../content/maps/systems-garden.map", import.meta.url),
).text();
const map = parseValve220(source, "systems-garden.map");
const entities = map.entities;
const compiledWorld = compileWorld(source, "systems-garden.map");
const gameConfig = (await Bun.file(
  new URL("../../content/trenchbroom/GameConfig.cfg", import.meta.url),
).json()) as {
  faceattribs: { defaults: { scale: [number, number] } };
  tags: {
    brushface: Array<{
      name: string;
      attribs: string[];
      match: string;
      pattern: string;
    }>;
  };
};

type Tuple3 = [number, number, number];
const subtract = (a: Tuple3, b: Tuple3): Tuple3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const cross = (a: Tuple3, b: Tuple3): Tuple3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Tuple3, b: Tuple3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("Systems Garden map", () => {
  test("rebuilds the saved-map bundle byte for byte", async () => {
    const bundle = compileWorld(source, "content/maps/systems-garden.map");
    const encoded = encodeWorldBundle(bundle);
    const committed = new Uint8Array(
      await Bun.file(
        new URL("../../content/generated/systems-garden.bin", import.meta.url),
      ).arrayBuffer(),
    );
    expect(bundle.mapRevision).toBe(
      "d8afb6583ccbde8f2dbeb74b1ea26b191fc7afadb661d7a2458957b3f81d02ce",
    );
    expect(new Bun.CryptoHasher("sha256").update(encoded).digest("hex")).toBe(
      "3d6c7e18afe0184d6aad40638e09618a12b5bafbd9ab2fc7c43e00ea04bd920e",
    );
    expect(encoded).toEqual(committed);
  });
  test("uses the same default material scale as TrenchBroom", () => {
    expect(MATERIAL_TEXTURE_SIZE).toBe(64);
    expect(gameConfig.faceattribs.defaults.scale).toEqual([0.5, 0.5]);
  });

  test("exposes special presentation materials as native TrenchBroom brush-face tags", () => {
    expect(gameConfig.tags.brushface).toEqual([
      {
        name: "Skip",
        attribs: ["transparent"],
        match: "material",
        pattern: SKIP_MATERIAL,
      },
      {
        name: "Reality",
        attribs: [],
        match: "material",
        pattern: "GURGUR/REAL/*",
      },
      {
        name: "Reality (Dylan)",
        attribs: [],
        match: "material",
        pattern: "GURGUR/dylans*",
      },
    ]);
  });

  test("keeps skip faces in collision while omitting them from presentation", () => {
    const skippedBrush = compiledWorld.brushes.find(
      (brush) =>
        brush.entityIndex === -1 &&
        brush.triangleMaterials.some((material) => material === SKIP_MATERIAL),
    );
    expect(skippedBrush).toBeDefined();
    const skippedTriangle = skippedBrush!.triangleMaterials.findIndex(
      (material) => material === SKIP_MATERIAL,
    );
    const skippedFace = skippedBrush!.triangleSourceFaces[skippedTriangle]!;
    expect(skippedBrush!.collisionOnlyFaceIndices).toContain(skippedFace);
    expect(compiledWorld.staticCollision.triangleSources).toContainEqual({
      entityIndex: -1,
      brushIndex: skippedBrush!.sourceBrushIndex,
      faceIndex: skippedFace,
    });
    expect(
      compiledWorld.renderBatches.some(
        (batch) => batch.material === SKIP_MATERIAL,
      ),
    ).toBeFalse();
  });

  test("preserves authored Valve 220 face axes, offsets, and non-default scales", () => {
    const authored = map.entities
      .flatMap((entity) =>
        entity.brushes.flatMap((brush) =>
          brush.faces.map((face) => ({ entity, brush, face })),
        ),
      )
      .find(
        ({ face }) =>
          face.material.startsWith("GURGUR/dylans") &&
          (face.scale[0] !== 0.5 || face.scale[1] !== 0.5),
      );
    expect(authored).toBeDefined();
    const compiled = compiledWorld.brushes.find(
      (brush) =>
        brush.entityIndex === -1 &&
        brush.sourceBrushIndex === authored!.brush.brushIndex,
    )!;
    const triangleIndex = compiled.triangleSourceFaces.indexOf(
      authored!.face.faceIndex,
    );
    expect(triangleIndex).toBeGreaterThanOrEqual(0);
    const vertexIndex = compiled.triangles[triangleIndex]![0]!;
    const point =
      map.entities[authored!.entity.entityIndex]!.brushes[
        authored!.brush.brushIndex
      ]!.faces[authored!.face.faceIndex]!;
    const mapVertex = compiled.worldVertices[vertexIndex]!;
    const valvePoint = {
      x: mapVertex.x / 0.0254,
      y: -mapVertex.z / 0.0254,
      z: mapVertex.y / 0.0254,
    };
    expect(compiled.triangleUvs[triangleIndex]![0]!.x).toBeCloseTo(
      (valvePoint.x * point.uAxis[0] +
        valvePoint.y * point.uAxis[1] +
        valvePoint.z * point.uAxis[2]) /
        point.scale[0] +
        point.uAxis[3],
    );
    expect(compiled.triangleUvs[triangleIndex]![0]!.y).toBeCloseTo(
      (valvePoint.x * point.vAxis[0] +
        valvePoint.y * point.vAxis[1] +
        valvePoint.z * point.vAxis[2]) /
        point.scale[1] +
        point.vAxis[3],
    );
  });

  test("declares Valve 220 and uses globally consistent face winding per brush", () => {
    expect(source.startsWith("// Game: Gurgur\n// Format: Valve\n")).toBe(true);
    expect(entities[0]?.properties.mapversion).toBe("220");
    const brushes = entities.flatMap((entity) => entity.brushes);
    for (const [brushIndex, brush] of brushes.entries()) {
      const compiled = compiledWorld.brushes[brushIndex]!;
      const center = compiled.worldVertices
        .map((point): Tuple3 => [
          point.x / 0.0254,
          -point.z / 0.0254,
          point.y / 0.0254,
        ])
        .reduce<Tuple3>(
          (sum, point) => [
            sum[0] + point[0],
            sum[1] + point[1],
            sum[2] + point[2],
          ],
          [0, 0, 0],
        )
        .map((value) => value / compiled.worldVertices.length) as Tuple3;
      const winding = brush.faces.map(({ points }) => {
        const [a, b, c] = points.map(({ x, y, z }): Tuple3 => [x, y, z]) as [
          Tuple3,
          Tuple3,
          Tuple3,
        ];
        const normal = cross(subtract(b, a), subtract(c, a));
        const side = dot(normal, subtract(center, a));
        expect(Math.abs(side)).toBeGreaterThan(1e-6);
        return Math.sign(side);
      });
      expect(new Set(winding).size).toBe(1);
    }
  });

  test("gives every persistent entity a unique authoredId", () => {
    const ids = new Set<string>();
    for (const entity of entities) {
      const classname = entity.properties.classname as EntityClassname;
      const definition = entityDefinitions[classname];
      expect(definition).toBeDefined();
      if (!definition?.editor.persistent) continue;
      const id = entity.properties.authoredId;
      expect(id).toBeTruthy();
      expect(ids.has(id!)).toBe(false);
      ids.add(id!);
    }
  });

  test("reconstructs every brush as finite convex geometry", () => {
    const authoredBrushCount = entities.reduce(
      (sum, entity) => sum + entity.brushes.length,
      0,
    );
    expect(compiledWorld.brushes).toHaveLength(authoredBrushCount);
    for (const compiled of compiledWorld.brushes) {
      expect(compiled.worldVertices.length).toBeGreaterThanOrEqual(4);
      expect(compiled.triangles.length).toBeGreaterThanOrEqual(4);
      expect(compiled.triangleSourceFaces).toHaveLength(
        compiled.triangles.length,
      );
      expect(compiled.triangleNormals).toHaveLength(compiled.triangles.length);
      expect(compiled.triangleUvs).toHaveLength(compiled.triangles.length);
      for (const vertex of compiled.worldVertices) {
        expect(Object.values(vertex).every(Number.isFinite)).toBe(true);
      }
    }
  });

  test("emits a deterministic v1 binary artifact with compiled UV/source identity", () => {
    const again = compileWorld(source, "systems-garden.map");
    expect(encodeWorldBundle(again)).toEqual(encodeWorldBundle(compiledWorld));
    expect(decodeWorldBundle(encodeWorldBundle(compiledWorld))).toEqual(
      compiledWorld,
    );
    expect(compiledWorld.mapRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(compiledWorld.bundleVersion).toBe(1);
  });

  test("authors the production light capability without mapper classnames", () => {
    const lights = compiledWorld.entities.filter(
      (entity) => entity.kind === "light",
    );
    expect(lights.map((entity) => entity.presentation.mode)).toEqual([
      "ambient",
      "directional",
      "spot",
    ]);
    const spotlight = lights.find(
      (entity) => entity.presentation.mode === "spot",
    );
    expect(spotlight?.presentation).toMatchObject({
      mode: "spot",
      castShadow: true,
      volumetric: true,
    });
    expect(JSON.stringify(lights)).not.toContain("light_spot");
  });

  test("keeps point entities out of brushes and solid entities inside them", () => {
    for (const entity of entities) {
      const definition =
        entityDefinitions[entity.properties.classname as EntityClassname];
      if (definition.editor.kind === "point")
        expect(entity.brushes.length).toBe(0);
      else expect(entity.brushes.length).toBeGreaterThan(0);
    }
  });
});
