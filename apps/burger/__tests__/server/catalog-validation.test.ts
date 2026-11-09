import { expect, test } from "bun:test";
import { validateCatalog } from "../../server/catalog-validation";

const ATLAS_W = 192;
const ATLAS_H = 288;

const ok = (label: string) => ({
  id: 1,
  type: "floor" as const,
  src_x: 0,
  src_y: 0,
  label,
});

test("valid single-entry catalog passes", () => {
  const result = validateCatalog([ok("floor")], {
    atlasW: ATLAS_W,
    atlasH: ATLAS_H,
  });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.entries).toHaveLength(1);
});

test("rejects non-array input", () => {
  const result = validateCatalog("not an array" as unknown, {
    atlasW: ATLAS_W,
    atlasH: ATLAS_H,
  });
  expect(result.ok).toBe(false);
});

test("rejects non-object array elements", () => {
  const result = validateCatalog([null, 42, "string", undefined], {
    atlasW: ATLAS_W,
    atlasH: ATLAS_H,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toHaveLength(4);
    expect(result.errors[0]?.field).toBe("entries[0]");
    expect(result.errors[0]?.message).toBe("must be object");
  }
});

test("rejects non-integer id", () => {
  const result = validateCatalog([{ ...ok("x"), id: 1.5 }], {
    atlasW: ATLAS_W,
    atlasH: ATLAS_H,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors[0]?.field).toContain("id");
});

test("rejects id < 1", () => {
  const result = validateCatalog([{ ...ok("x"), id: 0 }], {
    atlasW: ATLAS_W,
    atlasH: ATLAS_H,
  });
  expect(result.ok).toBe(false);
});

test("rejects unknown type", () => {
  const result = validateCatalog(
    [{ ...ok("x"), type: "lava" as unknown as "floor" }],
    { atlasW: ATLAS_W, atlasH: ATLAS_H },
  );
  expect(result.ok).toBe(false);
});

test("rejects empty label", () => {
  const result = validateCatalog([ok("")], {
    atlasW: ATLAS_W,
    atlasH: ATLAS_H,
  });
  expect(result.ok).toBe(false);
});

test("rejects src_x not aligned to TILE_SIZE", () => {
  const result = validateCatalog([{ ...ok("x"), src_x: 17 }], {
    atlasW: ATLAS_W,
    atlasH: ATLAS_H,
  });
  expect(result.ok).toBe(false);
});

test("rejects src_x out of atlas bounds", () => {
  const result = validateCatalog(
    [{ ...ok("x"), src_x: ATLAS_W }], // exactly at the edge — invalid
    { atlasW: ATLAS_W, atlasH: ATLAS_H },
  );
  expect(result.ok).toBe(false);
});

test("rejects duplicate ids", () => {
  const result = validateCatalog(
    [
      { ...ok("a"), id: 1 },
      { ...ok("b"), id: 1, src_x: 32 },
    ],
    { atlasW: ATLAS_W, atlasH: ATLAS_H },
  );
  expect(result.ok).toBe(false);
});

test("rejects duplicate src coords", () => {
  const result = validateCatalog(
    [
      { ...ok("a"), id: 1, src_x: 0, src_y: 0 },
      { ...ok("b"), id: 2, src_x: 0, src_y: 0 },
    ],
    { atlasW: ATLAS_W, atlasH: ATLAS_H },
  );
  expect(result.ok).toBe(false);
});

test("accepts a fully-populated catalog", () => {
  const entries = [
    { id: 1, type: "wall" as const, src_x: 0, src_y: 0, label: "wall" },
    { id: 2, type: "floor" as const, src_x: 32, src_y: 0, label: "floor" },
    { id: 3, type: "counter" as const, src_x: 0, src_y: 32, label: "counter" },
  ];
  const result = validateCatalog(entries, { atlasW: ATLAS_W, atlasH: ATLAS_H });
  expect(result.ok).toBe(true);
});
