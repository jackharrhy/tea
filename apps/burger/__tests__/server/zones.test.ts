import { expect, test, describe } from "bun:test";
import { canPaint, validateZoneName, validateZoneCells } from "../../server/zones";

const makeState = (
  zones: { id: number; cells: string[]; members: string[] }[],
) => {
  const zonesMap = new Map<
    number,
    { id: number; name: string; cells: Set<string>; members: Set<string> }
  >();
  const cellToZone = new Map<string, number>();
  for (const z of zones) {
    zonesMap.set(z.id, {
      id: z.id,
      name: `z${z.id}`,
      cells: new Set(z.cells),
      members: new Set(z.members),
    });
    for (const c of z.cells) cellToZone.set(c, z.id);
  }
  return { zones: zonesMap, cellToZone };
};

describe("canPaint", () => {
  test("admin always allowed, even outside any zone", () => {
    const w = makeState([]);
    expect(canPaint(w, "alice", 16, 16, true)).toBe(true);
  });

  test("non-admin allowed at cell inside their zone", () => {
    const w = makeState([{ id: 1, cells: ["16,16"], members: ["alice"] }]);
    expect(canPaint(w, "alice", 16, 16, false)).toBe(true);
  });

  test("non-admin rejected at cell inside a zone they don't belong to", () => {
    const w = makeState([{ id: 1, cells: ["16,16"], members: ["bob"] }]);
    expect(canPaint(w, "alice", 16, 16, false)).toBe(false);
  });

  test("non-admin rejected at cell that isn't in any zone", () => {
    const w = makeState([{ id: 1, cells: ["16,16"], members: ["alice"] }]);
    expect(canPaint(w, "alice", 48, 48, false)).toBe(false);
  });

  test("non-admin rejected when zone id is stale (zone deleted between maps)", () => {
    // Simulate: cellToZone references zone 1, but zones map doesn't have 1.
    const zones = new Map<
      number,
      { id: number; name: string; cells: Set<string>; members: Set<string> }
    >();
    const cellToZone = new Map<string, number>([["16,16", 1]]);
    expect(canPaint({ zones, cellToZone }, "alice", 16, 16, false)).toBe(false);
  });
});

describe("validateZoneName", () => {
  test("trims and accepts 1-32 chars", () => {
    expect(validateZoneName("  kitchen  ")).toEqual({
      ok: true,
      name: "kitchen",
    });
    expect(validateZoneName("a")).toEqual({ ok: true, name: "a" });
    expect(validateZoneName("a".repeat(32))).toEqual({
      ok: true,
      name: "a".repeat(32),
    });
  });

  test("rejects empty or whitespace-only", () => {
    expect(validateZoneName("").ok).toBe(false);
    expect(validateZoneName("   ").ok).toBe(false);
  });

  test("rejects >32 chars", () => {
    expect(validateZoneName("a".repeat(33)).ok).toBe(false);
  });

  test("rejects non-string", () => {
    expect(validateZoneName(undefined as unknown as string).ok).toBe(false);
    expect(validateZoneName(123 as unknown as string).ok).toBe(false);
  });
});

describe("validateZoneCells", () => {
  const bounds = { x: 0, y: 0, w: 2048, h: 2048 };

  test("accepts cell-center integer coords inside bounds", () => {
    const r = validateZoneCells(
      [
        [16, 16],
        [48, 16],
      ],
      bounds,
    );
    expect(r.cells).toEqual([
      [16, 16],
      [48, 16],
    ]);
    expect(r.dropped).toBe(0);
  });

  test("drops misaligned coords", () => {
    const r = validateZoneCells(
      [
        [15, 16],
        [16, 16],
      ],
      bounds,
    );
    expect(r.cells).toEqual([[16, 16]]);
    expect(r.dropped).toBe(1);
  });

  test("drops out-of-bounds coords", () => {
    const r = validateZoneCells(
      [
        [16, 16],
        [4096, 16],
      ],
      bounds,
    );
    expect(r.cells).toEqual([[16, 16]]);
    expect(r.dropped).toBe(1);
  });

  test("drops malformed entries", () => {
    const r = validateZoneCells(
      [[16, 16], "bad", [16], null, [1.5, 16]] as unknown as number[][],
      bounds,
    );
    expect(r.cells).toEqual([[16, 16]]);
    expect(r.dropped).toBe(4);
  });

  test("returns empty for non-array input", () => {
    const r = validateZoneCells(
      "not an array" as unknown as number[][],
      bounds,
    );
    expect(r.cells).toEqual([]);
    expect(r.dropped).toBe(0);
  });
});
