import { afterEach, expect, test } from "bun:test";
import { Hall, type Peer } from "../../server/hall";
import { tableSeatPosition } from "@harrhy/pool-simulation/geometry";
import { parseClientMessage, type ClientMessage } from "@harrhy/pool-protocol";

const halls: Hall[] = [];
afterEach(() => {
  for (const hall of halls.splice(0)) hall.dispose();
});
function game(tableId = "1") {
  const hall = new Hall();
  halls.push(hall);
  const peers: Peer[] = [
    { send() {}, close() {} },
    { send() {}, close() {} },
  ];
  const ids = peers.map((peer, i) => hall.connect(peer, `Player ${i}`)!);
  const table = hall.tables.find((t) => t.id === tableId)!;
  const count = tableId === "4" ? 1 : 2;
  for (let i = 0; i < count; i++) {
    const guest = hall.guests.get(ids[i]!)!;
    Object.assign(guest.state, tableSeatPosition(tableId, i as 0 | 1));
    hall.world.components.Position.x[guest.eid] = guest.state.x;
    hall.world.components.Position.z[guest.eid] = guest.state.z;
    hall.handle(ids[i]!, peers[i]!, { type: "join", table: tableId }, 1000);
  }
  const preview = (
    overrides: Partial<Extract<ClientMessage, { type: "cue" }>> = {},
  ) => ({
    type: "cue" as const,
    table: tableId,
    turn: table.match.shotNumber,
    angle: 0.6,
    power: 0.7,
    placement: null,
    ...overrides,
  });
  return { hall, table, ids, peers, preview };
}

test("cue packets validate finite bounded poses and strip extra properties", () => {
  const pose = {
    type: "cue" as const,
    table: "1",
    turn: 2,
    angle: 1,
    power: 0.5,
    placement: { x: 0.2, z: -0.4, extra: true },
  };
  expect(parseClientMessage(JSON.stringify({ ...pose, extra: true }))).toEqual({
    ...pose,
    placement: { x: 0.2, z: -0.4 },
  });
  for (const change of [
    { turn: -1 },
    { angle: Infinity },
    { power: 1.1 },
    { power: -0.1 },
    { placement: { x: 3, z: 0 } },
    { placement: { x: 0, z: NaN } },
    { placement: undefined },
  ])
    expect(
      parseClientMessage(JSON.stringify({ ...pose, ...change })),
    ).toBeNull();
});

test("only the current shooter publishes a cue without changing physical balls", () => {
  const { hall, table, ids, peers, preview } = game();
  const balls = structuredClone(table.balls);
  hall.handle(ids[1]!, peers[1]!, preview(), 1100);
  expect(table.cue).toBeNull();
  hall.handle(
    ids[0]!,
    peers[0]!,
    preview({ turn: table.match.shotNumber - 1 }),
    1100,
  );
  hall.handle(ids[0]!, peers[0]!, preview({ table: "2" }), 1100);
  expect(table.cue).toBeNull();
  hall.handle(ids[0]!, peers[0]!, preview(), 1100);
  expect(hall.snapshot().tables[0]!.cue).toMatchObject({
    player: ids[0],
    angle: 0.6,
    power: 0.7,
    placement: null,
  });
  expect(table.balls).toEqual(balls);
});

test("placement preview stays separate from authority and clears on real placement", () => {
  const { hall, table, ids, peers, preview } = game();
  table.match.phase = "ball-in-hand";
  const before = structuredClone(table.balls[0]);
  hall.handle(ids[0]!, peers[0]!, preview(), 1100);
  hall.handle(ids[0]!, peers[0]!, preview({ placement: { x: 1, z: 0 } }), 1100);
  expect(table.cue).toBeNull();
  hall.handle(
    ids[0]!,
    peers[0]!,
    preview({ placement: { x: 0.1, z: -0.4 } }),
    1100,
  );
  expect(table.balls[0]).toEqual(before);
  expect(table.cue?.placement).toEqual({ x: 0.1, z: -0.4 });
  hall.handle(ids[0]!, peers[0]!, preview(), 1101);
  expect(table.cue).toBeNull();
  hall.handle(
    ids[0]!,
    peers[0]!,
    preview({ placement: { x: 0.1, z: -0.4 } }),
    1102,
  );
  hall.handle(
    ids[0]!,
    peers[0]!,
    {
      type: "place",
      table: table.id,
      turn: table.match.shotNumber,
      x: 0.1,
      z: -0.4,
    },
    1110,
  );
  expect(table.cue).toBeNull();
  expect(table.match).toMatchObject({ phase: "aiming" });
  expect(table.balls[0]!.x).toBeCloseTo(0.1);
});

test("abandoned cues expire and disconnect removes the held cue immediately", () => {
  const { hall, table, ids, peers, preview } = game();
  hall.handle(ids[0]!, peers[0]!, preview(), 1100);
  hall.update(0, 2301);
  expect(table.cue).toBeNull();
  hall.handle(ids[0]!, peers[0]!, preview(), 2400);
  hall.disconnect(ids[0]!, peers[0]!);
  expect(table.cue).toBeNull();
});

test("the house bot shows placement and aim before its authoritative shot", () => {
  const { hall, table } = game("4");
  table.match.turn = 1;
  table.match.phase = "ball-in-hand";
  table.turnAt = 1000;
  hall.update(0, 1300);
  expect(table.cue?.player).toBe(hall.bot.id);
  expect(table.cue?.placement).not.toBeNull();
  hall.update(0, 1700);
  expect(table.match).toMatchObject({ phase: "aiming" });
  expect(table.cue?.placement).toBeNull();
  hall.update(0, 2400);
  expect(table.match).toMatchObject({ phase: "rolling" });
  expect(table.cue).toBeNull();
});
