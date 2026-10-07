import { describe, expect, it, vi } from "vitest";

import { parseBsp, type ParsedWorld } from "../src/core/index.js";
import {
  assertWalkabilityCompatible,
  generateWalkability,
  parseWalkability,
  planWalkabilityCutaway,
  serializeWalkability,
  WALKABILITY_CUTAWAY_EMPTY,
  walkabilitySeeds,
} from "../src/walkability/index.js";
import { loadWalkabilitySource } from "../src/viewer/walkability-source.js";
import { makeBsp } from "./fixtures.js";

const SPAWN_ENTITIES = `{
"classname" "worldspawn"
}
{
"classname" "info_player_start"
"origin" "8 8 36"
}
\0`;

function floorWorld(): ParsedWorld {
  return parseBsp(makeBsp({ collision: true, entityText: SPAWN_ENTITIES }));
}

function jumpLedgeWorld(): ParsedWorld {
  const world = parseBsp(
    makeBsp({
      collision: true,
      entityText: SPAWN_ENTITIES.replace("8 8 36", "4 8 36"),
    }),
  );
  return {
    ...world,
    collision: {
      // X >= 8 has a standing-origin floor at Z 60; X < 8 is at Z 36. The 24-unit rise is
      // taller than the normal 18-unit step but remains reachable by a jump.
      planes: new Float32Array([1, 0, 0, 8, 0, 0, 1, 60, 0, 0, 1, 36]),
      clipnodes: new Int32Array([0, 1, 2, 1, -1, -2, 2, -1, -2]),
    },
  };
}

describe("walkability", () => {
  it("grounds player-start entities and deterministically fills their reachable surface", async () => {
    const world = floorWorld();
    expect(walkabilitySeeds(world)).toEqual([
      {
        position: [8, 8, 36.03125],
        floorNormal: [0, 0, 1],
        entityIndex: 1,
      },
    ]);

    const options = { spacing: 8, maximumNodes: 100, yieldEvery: 0 } as const;
    const first = await generateWalkability(world, options);
    const second = await generateWalkability(world, options);
    expect(first).toEqual(second);
    expect(first.statistics).toMatchObject({
      nodes: 13,
      components: 1,
      jumpEdges: 0,
      truncated: false,
    });
    expect(first.nodes.every((node) => node.position[2] === 36.03125)).toBe(
      true,
    );
  });

  it("enforces the minimum spacing and maximum node budget", async () => {
    const generated = await generateWalkability(floorWorld(), {
      spacing: 1,
      directions: 4,
      maximumNodes: 500_000,
      allowJump: false,
      yieldEvery: 0,
    });

    expect(generated.parameters.spacing).toBe(8);
    expect(generated.parameters.mergeDistance).toBeCloseTo(2.72);
    expect(generated.parameters.maximumNodes).toBe(200_000);
    expect(generated.statistics.nodes).toBeGreaterThan(1);
  });

  it("uses and preserves the default node budget in sidecars", async () => {
    const generated = await generateWalkability(floorWorld(), {
      spacing: 8,
      allowJump: false,
      yieldEvery: 0,
    });

    expect(generated.parameters.maximumNodes).toBe(200_000);
    expect(generated.statistics.truncated).toBe(false);
    expect(parseWalkability(serializeWalkability(generated))).toEqual(
      generated,
    );
  });

  it("records jumps and drops as directed traversal rather than flattening reachability", async () => {
    const world = jumpLedgeWorld();
    const withoutJump = await generateWalkability(world, {
      spacing: 8,
      maximumNodes: 100,
      allowJump: false,
      yieldEvery: 0,
    });
    expect(withoutJump.statistics.jumpEdges).toBe(0);
    expect(withoutJump.nodes.every((node) => node.position[2] < 50)).toBe(true);

    const withJump = await generateWalkability(world, {
      spacing: 8,
      maximumNodes: 100,
      allowJump: true,
      yieldEvery: 0,
    });
    expect(withJump.statistics.jumpEdges).toBeGreaterThan(0);
    expect(withJump.statistics.dropEdges).toBeGreaterThan(0);
    expect(withJump.nodes.some((node) => node.position[2] > 50)).toBe(true);
  });

  it("round-trips a validated sidecar and rejects stale or malformed data", async () => {
    const world = floorWorld();
    const generated = await generateWalkability(world, {
      spacing: 8,
      maximumNodes: 100,
      yieldEvery: 0,
    });
    const parsed = parseWalkability(serializeWalkability(generated));
    expect(parsed).toEqual(generated);
    expect(() => assertWalkabilityCompatible(world, parsed)).not.toThrow();
    expect(() =>
      assertWalkabilityCompatible(
        { ...world, bounds: { min: [-1, 0, 0], max: world.bounds.max } },
        parsed,
      ),
    ).toThrow(/generated for/);

    const malformed = JSON.parse(serializeWalkability(generated)) as {
      edges: Array<{ to: number }>;
    };
    malformed.edges[0]!.to = 99_999;
    expect(() => parseWalkability(malformed)).toThrow(/out of range/);
  });

  it("loads, validates, and reports progress for a persisted sidecar source", async () => {
    const world = floorWorld();
    const generated = await generateWalkability(world, {
      spacing: 8,
      maximumNodes: 100,
      yieldEvery: 0,
    });
    const progress: Array<{ readonly phase: string; readonly loaded: number }> =
      [];
    const fetch = vi.fn(
      async () => new Response(serializeWalkability(generated)),
    );
    const loaded = await loadWalkabilitySource(
      world,
      "https://example.test/walkability.json",
      {
        fetch,
        signal: new AbortController().signal,
        progress: (detail) => progress.push(detail),
      },
    );

    expect(loaded).toEqual(generated);
    expect(fetch).toHaveBeenCalledOnce();
    expect(progress.at(-1)).toMatchObject({ phase: "walkability" });
  });

  it("rejects incompatible sidecars and respects cancellation before fetching", async () => {
    const world = floorWorld();
    const generated = await generateWalkability(world, {
      spacing: 8,
      maximumNodes: 100,
      yieldEvery: 0,
    });
    const incompatible = {
      ...world,
      bounds: { min: [-1, 0, 0] as const, max: world.bounds.max },
    };
    const fetch = vi.fn<typeof globalThis.fetch>();
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(
      loadWalkabilitySource(
        incompatible,
        new Blob([serializeWalkability(generated)]),
        {
          fetch: globalThis.fetch,
          signal: new AbortController().signal,
          progress: () => undefined,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid-data" });
    await expect(
      loadWalkabilitySource(world, "https://example.test/walkability.json", {
        fetch,
        signal: controller.signal,
        progress: () => undefined,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("builds a bounded local cutaway field from reachable standing heights", async () => {
    const generated = await generateWalkability(floorWorld(), {
      spacing: 8,
      maximumNodes: 100,
      yieldEvery: 0,
    });
    const walkability = {
      ...generated,
      nodes: [
        {
          id: 0,
          position: [8, 8, 36] as const,
          floorNormal: [0, 0, 1] as const,
          ceilingOriginZ: 60,
          seed: true,
          component: 0,
        },
        {
          id: 1,
          position: [40, 8, 100] as const,
          floorNormal: [0, 0, 1] as const,
          ceilingOriginZ: null,
          seed: false,
          component: 1,
        },
      ],
    };
    const grid = planWalkabilityCutaway(
      walkability,
      { min: [0, 0, 0], max: [64, 64, 192] },
      { cellSize: 8, clearance: 48, influence: 8 },
    );

    expect(grid).toMatchObject({
      width: 8,
      height: 8,
      cellSize: 8,
      coveredCells: 18,
    });
    expect(grid.values[1 * grid.width + 1]).toBe(60);
    expect(grid.values[1 * grid.width + 2]).toBe(60);
    expect(grid.values[1 * grid.width + 5]).toBe(148);
    expect(grid.values[7 * grid.width + 7]).toBe(WALKABILITY_CUTAWAY_EMPTY);

    const firstComponent = planWalkabilityCutaway(
      walkability,
      { min: [0, 0, 0], max: [64, 64, 192] },
      { cellSize: 8, clearance: 48, influence: 8, component: 0 },
    );
    expect(firstComponent.values[1 * firstComponent.width + 5]).toBe(
      WALKABILITY_CUTAWAY_EMPTY,
    );
  });
});
