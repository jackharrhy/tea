import { expect, test } from "bun:test";
import * as THREE from "three/webgpu";
import { createMatch, createRack } from "@tea/pool";
import type { TableState } from "@tea/pool-protocol";
import { TablePresence } from "../../../app/game/scene/table-presence";
import { cuePose } from "../../../app/game/scene/cue-pose";

function fixture() {
  const group = new THREE.Group();
  group.position.set(7, 0, -5);
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  group.add(ball);
  const template = new THREE.Group();
  template.add(new THREE.Mesh(new THREE.CylinderGeometry()));
  const invalidated: string[] = [];
  const presence = new TablePresence(
    new Map([["1", group]]),
    new Map([["1", [ball]]]),
    template,
    (id) => invalidated.push(id),
  );
  const table: TableState = {
    id: "1",
    rack: 0,
    rematchReady: [],
    match: { ...createMatch(), phase: "aiming", players: ["shooter", "other"] },
    balls: createRack().map((candidateBall) => ({
      ...candidateBall,
      y: 0,
      vy: 0,
      q: [0, 0, 0, 1],
      w: [0, 0, 0],
      stage: "table",
      revision: 0,
    })),
    cue: {
      player: "shooter",
      turn: 0,
      angle: Math.PI - 0.1,
      power: 0,
      placement: null,
      at: 1000,
    },
  };
  const cue = group.getObjectByName("remote-cue")!;
  const ghost = group.getObjectByName("placement-ghost") as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >;
  return { group, ball, presence, table, cue, ghost, template, invalidated };
}

test("remote cue takes the shortest angle path, damps pull and applies the table offset once", () => {
  const { presence, table, cue, ball, template } = fixture();
  presence.update([table], "spectator", null, 1 / 60, 1000);
  table.cue!.angle = -Math.PI + 0.1;
  table.cue!.power = 1;
  presence.update([table], "spectator", null, 1 / 60, 1016);
  const blend = 1 - Math.exp(-12 / 60);
  const pose = cuePose(ball.position, Math.PI - 0.1 + 0.2 * blend, blend);
  const world = cue.getWorldPosition(new THREE.Vector3());
  expect(world.x).toBeCloseTo(7 + pose.position[0], 8);
  expect(world.z).toBeCloseTo(-5 + pose.position[2], 8);
  expect(cue.visible).toBe(true);
  expect((cue.children[0] as THREE.Mesh).geometry).toBe(
    (template.children[0] as THREE.Mesh).geometry,
  );
  presence.dispose();
});

test("remote cues hide for self, expiry, stale turns and missing tables", () => {
  const { presence, table, cue } = fixture();
  for (const reason of ["self", "expiry", "turn", "missing"]) {
    table.match.phase = "aiming";
    table.cue!.turn = 0;
    presence.update([table], "spectator", null, 1 / 60, 1000);
    expect(cue.visible).toBe(true);
    if (reason === "turn") table.cue!.turn = 1;
    presence.update(
      reason === "missing" ? [] : [table],
      reason === "self" ? "shooter" : "spectator",
      null,
      1 / 60,
      reason === "expiry" ? 2200 : 1000,
    );
    expect(cue.visible).toBe(false);
  }
  presence.dispose();
});

test("remote stroke holds 85ms, reaches contact at 125ms and hides at 180ms", () => {
  const { presence, table, cue, ball } = fixture();
  table.cue!.power = 0.8;
  presence.update([table], "spectator", null, 1 / 60, 1000);
  const held = cue.position.clone();
  table.match.phase = "rolling";
  delete table.cue;
  presence.update([table], "spectator", null, 1 / 60, 1010);
  ball.position.set(0.4, 0, 0.7);
  presence.update([table], "spectator", null, 1 / 60, 1095);
  expect(cue.visible).toBe(true);
  expect(cue.position.toArray()).toEqual(held.toArray());
  presence.update([table], "spectator", null, 1 / 60, 1115);
  const halfway = cuePose({ x: 0, z: 0 }, Math.PI - 0.1, 0.8 * 0.25);
  expect(
    cue.position.distanceTo(new THREE.Vector3(...halfway.position)),
  ).toBeLessThan(1e-10);
  presence.update([table], "spectator", null, 1 / 60, 1135);
  const contact = cuePose({ x: 0, z: 0 }, Math.PI - 0.1, 0, true);
  expect(
    cue.position.distanceTo(new THREE.Vector3(...contact.position)),
  ).toBeLessThan(1e-10);
  presence.update([table], "spectator", null, 1 / 60, 1189);
  expect(cue.visible).toBe(true);
  presence.update([table], "spectator", null, 1 / 60, 1190);
  expect(cue.visible).toBe(false);
  presence.dispose();
});

test("expired, cancelled and wrong-turn aim never starts a remote stroke", () => {
  for (const reason of ["expired", "cancelled", "turn", "phase"]) {
    const { presence, table, cue } = fixture();
    presence.update([table], "spectator", null, 1 / 60, 1000);
    delete table.cue;
    if (reason === "cancelled") {
      presence.update([table], "spectator", null, 1 / 60, 1010);
    }
    if (reason === "turn") table.match.shotNumber++;
    table.match.phase = reason === "phase" ? "ball-in-hand" : "rolling";
    presence.update(
      [table],
      "spectator",
      null,
      1 / 60,
      reason === "expired" ? 2200 : 1020,
    );
    expect(cue.visible).toBe(false);
    presence.dispose();
  }
});

test("local placement is immediate, validates overlap and restores the existing cue ball", () => {
  const { presence, table, ball, ghost } = fixture();
  table.match.phase = "ball-in-hand";
  presence.update(
    [table],
    "shooter",
    { table: "1", point: { x: 0.2, z: -0.4 } },
    1 / 60,
    1000,
  );
  expect(ghost.position.x).toBe(0.2);
  expect(ghost.material.color.getHex()).toBe(0xffffff);
  expect(ball.visible).toBe(false);
  const objectBall = table.balls.find(
    (candidateBall) => candidateBall.id === 1,
  )!;
  presence.update(
    [table],
    "shooter",
    { table: "1", point: objectBall },
    1 / 60,
    1000,
  );
  expect(ghost.position.x).toBe(objectBall.x);
  expect(ghost.material.color.getHex()).toBe(0xe34b44);
  presence.update([table], "shooter", null, 1 / 60, 1000);
  expect(ghost.visible).toBe(false);
  expect(ball.visible).toBe(true);
  presence.dispose();
});

test("remote placement eases and restores visibility when presence expires", () => {
  const { presence, table, ball, ghost, cue, invalidated } = fixture();
  table.match.phase = "ball-in-hand";
  table.cue!.placement = { x: 0, z: -0.4 };
  presence.update([table], "spectator", null, 1 / 60, 1000);
  expect(invalidated).toEqual(["1"]);
  table.cue!.placement.x = 0.5;
  presence.update([table], "spectator", null, 1 / 60, 1016);
  expect(invalidated).toEqual(["1", "1"]);
  expect(ghost.position.x).toBeGreaterThan(0);
  expect(ghost.position.x).toBeLessThan(0.5);
  expect(ball.visible).toBe(false);
  expect(cue.visible).toBe(false);
  presence.update([table], "spectator", null, 1 / 60, 2200);
  expect(invalidated).toEqual(["1", "1", "1"]);
  expect(ghost.visible).toBe(false);
  expect(ball.visible).toBe(true);
  presence.dispose();
});

test("stationary placement keeps cached shadows; removal and disposal invalidate them", () => {
  const { presence, table, ball, invalidated } = fixture();
  table.match.phase = "ball-in-hand";
  const placement = { table: "1", point: { x: 0.2, z: -0.4 } };
  presence.update([table], "shooter", placement, 1 / 60, 1000);
  presence.update([table], "shooter", placement, 1 / 60, 1016);
  expect(invalidated).toEqual(["1"]);
  presence.update([], "shooter", null, 1 / 60, 1032);
  expect(invalidated).toEqual(["1", "1"]);
  expect(ball.visible).toBe(true);
  presence.update([table], "shooter", placement, 1 / 60, 1048);
  presence.dispose();
  expect(invalidated).toEqual(["1", "1", "1", "1"]);
  expect(ball.visible).toBe(true);
});
