import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { ClientDiagnostic, ServerMessage } from "@tea/pool-protocol";
import { INPUT_DT } from "@tea/pool-protocol";
import { tableSeatPosition } from "@tea/pool-simulation/geometry";
import { Hall } from "../../server/hall";
import { GameRecorder } from "../../server/recordings";

const resources: (() => void)[] = [];
afterEach(() => {
  for (const close of resources.splice(0).toReversed()) close();
});

function game() {
  const db = new Database(":memory:");
  const logs: Record<string, unknown>[] = [];
  const recorder = new GameRecorder(db, { log: (event) => logs.push(event) });
  const hall = new Hall(undefined, recorder);
  resources.push(
    () => db.close(),
    () => hall.dispose(),
  );
  const messages: ServerMessage[] = [];
  const peers = [0, 1].map(() => ({
    send: (raw: string) => messages.push(JSON.parse(raw)),
    close() {},
  }));
  const ids = peers.map((peer, i) => hall.connect(peer, `Player ${i}`)!);
  const table = hall.tables[0];
  for (const seat of [0, 1] as const) {
    const guest = hall.guests.get(ids[seat])!;
    const point = tableSeatPosition(table.id, seat);
    guest.state.x = hall.world.components.Position.x[guest.eid] = point.x;
    guest.state.z = hall.world.components.Position.z[guest.eid] = point.z;
    hall.handle(ids[seat], peers[seat], { type: "join", table: table.id });
  }
  return { hall, peers, ids, table, db, logs, messages };
}

const report = (table: string, turn: number): ClientDiagnostic => ({
  type: "diagnostic",
  kind: "pool",
  table,
  turn,
  durationMs: 10000,
  count: 3,
  maxError: 0.2,
  errorBins: [0, 0, 3, 0],
  maxPacketGapMs: 250,
});

test("client correction reports require the live peer and seated table and are rate limited", () => {
  const { hall, peers, ids, table, logs } = game();
  const turn = table.match.shotNumber;
  hall.handle(ids[0], peers[0], {
    type: "shot",
    id: "first",
    table: table.id,
    turn,
    angle: 0,
    power: 0.1,
  });
  hall.update(INPUT_DT);
  const before = structuredClone(table.match);
  hall.handle(ids[0], peers[1], report(table.id, turn), 20000);
  hall.handle(ids[0], peers[0], report("4", turn), 20000);
  hall.handle(ids[0], peers[0], report(table.id, turn + 999), 20000);
  for (let i = 0; i < 6; i++)
    hall.handle(ids[0], peers[0], report(table.id, turn), 30000);
  expect(
    logs.filter((e) => e.event === "client_network_correction"),
  ).toHaveLength(4);
  expect(table.match).toEqual(before);
  hall.handle(ids[0], peers[0], report(table.id, turn), 40000);
  expect(
    logs.filter((e) => e.event === "client_network_correction"),
  ).toHaveLength(5);
});

test("gravity experiments cannot change an active connected human match, lighting can", () => {
  const { hall, table, messages } = game();
  const original = hall.getRoomSettings();
  expect(hall.hasActiveHumanMatch()).toBe(true);
  expect(
    hall.setRoomSettings({
      lightIntensity: 0.7,
      gravity: [2, -9.81, 0],
      cutaway: true,
    }),
  ).toBe(false);
  expect(hall.getRoomSettings()).toEqual(original);
  expect(
    hall.setRoomSettings({ ...original, lightIntensity: 0.7, cutaway: true }),
  ).toBe(true);
  expect(messages.some((m) => m.type === "room-settings")).toBe(true);
  table.match.phase = "finished";
  expect(hall.setRoomSettings({ ...original, gravity: [2, -9.81, 0] })).toBe(
    true,
  );
  const copy = hall.getRoomSettings();
  copy.gravity[0] = 15;
  expect(hall.getRoomSettings().gravity[0]).toBe(2);
});
