import { describe, expect, it } from "vitest";
import {
  applyCollaborationOperation,
  collaborationEditsBetween,
  createBoxBrush,
  createBrushEntity,
  createSequentialIdFactory,
  createStarterDocument,
  insertEntity,
  insertBrush,
  removeEntities,
  OrderedCollaborationReplica,
  simulateCollaborationDelivery,
  translateBrush,
  type CollaborationOperation,
} from "../src/core/index.js";

function operation(
  operationId: string,
  actorId: string,
  edits: CollaborationOperation["edits"],
): CollaborationOperation {
  return {
    schemaVersion: 1,
    operationId,
    transactionId: operationId,
    actorId,
    baseMapVersion: 0,
    label: operationId,
    edits,
  };
}

describe("collaboration operations", () => {
  it("persists point entity creation and deletion as semantic operations", () => {
    const ids = createSequentialIdFactory("entities");
    const baseline = createStarterDocument();
    const light = {
      id: ids.entity(),
      properties: { classname: "light", origin: "64 64 64", light: "300" },
      primitives: [],
    };
    const created = insertEntity(baseline, light);
    const createResult = applyCollaborationOperation(
      baseline,
      operation(
        "entity:create",
        "alice",
        collaborationEditsBetween(baseline, created),
      ),
    );
    expect(createResult).toMatchObject({
      status: "applied",
      document: { entities: created.entities },
    });
    if (createResult.status !== "applied") return;

    const deleted = removeEntities(created, [light.id]);
    const deleteResult = applyCollaborationOperation(
      createResult.document,
      operation(
        "entity:delete",
        "alice",
        collaborationEditsBetween(created, deleted),
      ),
    );
    expect(deleteResult).toMatchObject({
      status: "applied",
      document: { entities: deleted.entities },
    });
  });

  it("persists brush entity creation and brush ownership", () => {
    const ids = createSequentialIdFactory("brush-entity");
    const starter = createStarterDocument();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], "STONE", ids);
    const baseline = insertBrush(starter, starter.entities[0]!.id, brush);
    const door = {
      id: ids.entity(),
      properties: { classname: "func_door" },
      primitives: [],
    };
    const after = createBrushEntity(baseline, [brush.id], door);
    const edits = collaborationEditsBetween(baseline, after);
    expect(edits.map(({ kind }) => kind)).toEqual([
      "insert-entity",
      "move-brush",
    ]);

    const result = applyCollaborationOperation(
      baseline,
      operation("entity:brush", "alice", edits),
    );
    expect(result).toMatchObject({
      status: "applied",
      document: { entities: after.entities },
    });
  });

  it("derives and deterministically applies independent semantic edits", () => {
    const ids = createSequentialIdFactory("collaboration");
    let baseline = createStarterDocument();
    const world = baseline.entities[0]!;
    const first = createBoxBrush([0, 0, 0], [64, 64, 64], "STONE", ids);
    const second = createBoxBrush([128, 0, 0], [192, 64, 64], "STONE", ids);
    baseline = insertBrush(
      insertBrush(baseline, world.id, first),
      world.id,
      second,
    );
    const baselineWorld = baseline.entities.find(
      (entity) => entity.id === world.id,
    )!;
    const worldIndex = baseline.entities.indexOf(baselineWorld);

    const firstAfter = translateBrush(first, [16, 0, 0]);
    const secondAfter = translateBrush(second, [0, 16, 0]);
    const opA = operation(
      "a:1",
      "a",
      collaborationEditsBetween(baseline, {
        ...baseline,
        entities: baseline.entities.with(worldIndex, {
          ...baselineWorld,
          primitives: baselineWorld.primitives.map((brush) =>
            brush.id === first.id ? firstAfter : brush,
          ),
        }),
      }),
    );
    const opB = operation(
      "b:1",
      "b",
      collaborationEditsBetween(baseline, {
        ...baseline,
        entities: baseline.entities.with(worldIndex, {
          ...baselineWorld,
          primitives: baselineWorld.primitives.map((brush) =>
            brush.id === second.id ? secondAfter : brush,
          ),
        }),
      }),
    );

    const firstResult = applyCollaborationOperation(baseline, opA);
    expect(firstResult.status).toBe("applied");
    if (firstResult.status !== "applied") return;
    const secondResult = applyCollaborationOperation(firstResult.document, opB);
    expect(secondResult.status).toBe("applied");
    if (secondResult.status !== "applied") return;

    const replica = applyCollaborationOperation(baseline, opA);
    expect(replica.status).toBe("applied");
    if (replica.status !== "applied") return;
    const converged = applyCollaborationOperation(replica.document, opB);
    expect(converged).toEqual(secondResult);
  });

  it("rejects stale same-brush geometry atomically and recognizes duplicate delivery", () => {
    const ids = createSequentialIdFactory("conflict");
    const starter = createStarterDocument();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], "STONE", ids);
    const baseline = insertBrush(starter, starter.entities[0]!.id, brush);
    const opA = operation("a:1", "a", [
      {
        kind: "replace-brush",
        brushId: brush.id,
        baseRevision: brush.revision,
        brush: translateBrush(brush, [8, 0, 0]),
      },
    ]);
    const opB = operation("b:1", "b", [
      {
        kind: "replace-brush",
        brushId: brush.id,
        baseRevision: brush.revision,
        brush: translateBrush(brush, [0, 8, 0]),
      },
    ]);
    const accepted = applyCollaborationOperation(baseline, opA);
    expect(accepted.status).toBe("applied");
    if (accepted.status !== "applied") return;
    expect(applyCollaborationOperation(accepted.document, opB).status).toBe(
      "conflict",
    );
    expect(
      applyCollaborationOperation(accepted.document, opA, new Set(["a:1"]))
        .status,
    ).toBe("duplicate");
  });

  it("converges three replicas under delayed, duplicated, and reversed delivery", () => {
    const ids = createSequentialIdFactory("replicas");
    const starter = createStarterDocument();
    const brushes = Array.from({ length: 3 }, (_, index) =>
      createBoxBrush(
        [index * 96, 0, 0],
        [index * 96 + 64, 64, 64],
        "STONE",
        ids,
      ),
    );
    let baseline = starter;
    for (const brush of brushes)
      baseline = insertBrush(baseline, starter.entities[0]!.id, brush);
    const frames = brushes.map((brush, index) => ({
      mapVersion: index + 1,
      operation: operation(`actor:${index}`, `actor-${index}`, [
        {
          kind: "replace-brush" as const,
          brushId: brush.id,
          baseRevision: brush.revision,
          brush: translateBrush(brush, [0, 0, 16]),
        },
      ]),
    }));
    const replicas = [
      {
        replica: new OrderedCollaborationReplica(baseline),
        delivery: [...frames],
      },
      {
        replica: new OrderedCollaborationReplica(baseline),
        delivery: frames.toReversed(),
      },
      {
        replica: new OrderedCollaborationReplica(baseline),
        delivery: [frames[1]!, frames[0]!, frames[1]!, frames[2]!, frames[0]!],
      },
    ];
    for (const { replica, delivery } of replicas) {
      for (const frame of delivery) expect(replica.receive(frame)).toEqual([]);
      expect(replica.mapVersion).toBe(3);
    }
    expect(replicas[1]!.replica.document).toEqual(
      replicas[0]!.replica.document,
    );
    expect(replicas[2]!.replica.document).toEqual(
      replicas[0]!.replica.document,
    );

    const simulation = simulateCollaborationDelivery(
      baseline,
      frames,
      0x5eed,
      3,
    );
    expect(simulation.deliveredFrames).toBeGreaterThan(frames.length * 3);
    expect(simulation.conflicts).toEqual([]);
    expect(
      simulation.replicas.every(
        (replica) => replica.mapVersion === frames.length,
      ),
    ).toBe(true);
    expect(simulation.replicas[1]!.document).toEqual(
      simulation.replicas[0]!.document,
    );
    expect(simulation.replicas[2]!.document).toEqual(
      simulation.replicas[0]!.document,
    );
  });
});
