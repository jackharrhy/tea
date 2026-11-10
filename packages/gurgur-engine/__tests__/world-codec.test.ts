import { describe, expect, test } from "bun:test";
import {
  decodeCompiledEntityCapabilities,
  decodeWorldBundle,
  encodeWorldBundle,
  type WorldBundle,
} from "../src";

const decode = (bytes: ArrayBuffer | ArrayBufferView): WorldBundle =>
  decodeWorldBundle(bytes, decodeCompiledEntityCapabilities);

const bundle = (): WorldBundle => ({
  bundleVersion: 1,
  mapRevision: "a".repeat(64),
  sourceName: "fixture.map",
  settings: {
    title: "Fixture",
    gravity: { x: 0, y: -9.5, z: 0 },
    skyColor: { r: 0.1, g: 0.2, b: 0.3 },
  },
  playerSpawns: [{ name: "default", position: { x: 0, y: 1, z: 0 }, yaw: 0 }],
  resetMarkers: [],
  entities: [],
  brushes: [
    {
      entityIndex: -1,
      sourceBrushIndex: 0,
      center: { x: 0, y: 0, z: 0 },
      collisionOnlyFaceIndices: [],
      worldVertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      localVertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      triangles: [[0, 2, 1]],
      triangleMaterials: ["STONE"],
      triangleSourceFaces: [4],
      triangleNormals: [{ x: 0, y: 1, z: 0 }],
      triangleUvs: [
        [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 0 },
        ],
      ],
    },
  ],
  staticCollision: {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    triangles: [[0, 2, 1]],
    triangleSources: [{ entityIndex: -1, brushIndex: 0, faceIndex: 4 }],
  },
  renderBatches: [
    {
      material: "STONE",
      sensor: false,
      positions: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 0 },
      ],
      normals: [
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      uvs: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
      indices: [0, 1, 2],
      triangleSources: [{ entityIndex: -1, brushIndex: 0, faceIndex: 4 }],
    },
  ],
});

describe("v1 binary world bundle", () => {
  test("round-trips deterministic settings, partitions, and binary geometry", () => {
    const first = encodeWorldBundle(bundle());
    expect(encodeWorldBundle(bundle())).toEqual(first);
    expect(decode(first)).toEqual(bundle());
  });

  test("keeps collision-only faces in physics while omitting their render batches", () => {
    const collisionOnly = bundle();
    collisionOnly.brushes[0]!.collisionOnlyFaceIndices = [4];
    collisionOnly.renderBatches = [];
    const decoded = decode(encodeWorldBundle(collisionOnly));
    expect(decoded.staticCollision.triangles).toEqual([[0, 2, 1]]);
    expect(decoded.staticCollision.triangleSources).toEqual([
      { entityIndex: -1, brushIndex: 0, faceIndex: 4 },
    ]);
    expect(decoded.renderBatches).toEqual([]);
  });

  test("structurally rejects malformed entity capabilities", () => {
    const malformed: { entities: unknown[] } & Omit<WorldBundle, "entities"> =
      bundle();
    malformed.entities = [
      {
        kind: "physics-prop",
        authoredId: "crate",
        body: { kind: "dynamic-brush", brushIndices: [99] },
        presentation: { kind: "brush", transform: "body" },
        interaction: "grab",
      },
    ];
    expect(() =>
      decode(encodeWorldBundle(malformed as unknown as WorldBundle)),
    ).toThrow();
  });

  test("rejects unsupported, truncated, and corrupt section tables", () => {
    const version = encodeWorldBundle(bundle());
    version[4] = 99;
    expect(() => decode(version)).toThrow("unsupported");
    expect(() => decode(new Uint8Array([1, 2, 3]))).toThrow("truncated");
    const bounds = encodeWorldBundle(bundle());
    new DataView(bounds.buffer).setUint32(10, 0xffff_ffff, true);
    expect(() => decode(bounds)).toThrow("out of bounds");
  });
});
