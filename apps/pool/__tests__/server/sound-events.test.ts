import { afterEach, expect, test } from "bun:test";
import { INPUT_DT } from "@tea/pool-protocol";
import { Hall } from "../../server/hall";
import { tableSeatPosition } from "@tea/pool-simulation/geometry";
import { POCKETS } from "@tea/pool/table";

const halls: Hall[] = [];
function hall() {
  const h = new Hall();
  halls.push(h);
  return h;
}
afterEach(() => {
  for (const h of halls.splice(0)) h.dispose();
});

test("snapshot ring retains history on simulation time, copies values, and expires to an empty baseline", () => {
  const h = hall();
  const table = h.tables[0]!;
  table.physics.strike(0, 0.2);
  h.update(INPUT_DT, 999999999);
  const first = h.snapshot().tables[0]!.sounds!;
  expect(first.some((s) => s.kind === "cue")).toBe(true);
  expect(first[0]!.time).toBe(INPUT_DT * 1000);
  const id = first[0]!.id;
  first[0]!.speed = -1;
  h.update(INPUT_DT, -1000);
  const retained = h.snapshot().tables[0]!.sounds!.find((s) => s.id === id)!;
  expect(retained.speed).toBeGreaterThan(0);
  expect(retained.time).toBe(INPUT_DT * 1000);
  for (let i = 0; i < 16; i++) h.update(0, 0);
  expect(h.snapshot().tables[0]!.sounds).toEqual([]);
  h.update(0, 0);
  expect(h.snapshot().tables[0]!.sounds).toEqual([]);
});

test("ring is capped and new rack clears history while keeping ids monotonic", () => {
  const h = hall();
  const table = h.tables[0]!;
  for (let i = 0; i < 20; i++) {
    table.physics.reset();
    table.physics.placeCue(0, 0.4);
    table.physics.strike(Math.PI / 2, 1);
    h.update(0.2, 0);
    expect(h.snapshot().tables[0]!.sounds!.length).toBeLessThanOrEqual(48);
  }
  expect(table.sounds).toHaveLength(48);
  const lastId = table.nextSoundId;
  for (const seat of [0, 1] as const) {
    const peer = { send() {}, close() {} };
    const id = h.connect(peer, "Player " + seat)!;
    const guest = h.guests.get(id)!;
    Object.assign(guest.state, tableSeatPosition(table.id, seat));
    h.handle(id, peer, { type: "join", table: table.id }, 0);
  }
  expect(h.snapshot().tables[0]!.sounds).toEqual([]);
  table.physics.strike(0, 0.2);
  h.update(INPUT_DT, 0);
  expect(h.snapshot().tables[0]!.sounds![0]!.id).toBeGreaterThan(lastId);
});

test("strike turn survives resolution and returns are sampled outside rolling", () => {
  const h = hall();
  const table = h.tables[0]!;
  const peers = [0, 1].map(() => ({ send() {}, close() {} }));
  const ids = peers.map((peer, seat) => {
    const id = h.connect(peer, "Player " + seat)!;
    Object.assign(
      h.guests.get(id)!.state,
      tableSeatPosition(table.id, seat as 0 | 1),
    );
    h.handle(id, peer, { type: "join", table: table.id }, 0);
    return id;
  });
  const turn = table.match.shotNumber;
  h.handle(
    ids[0]!,
    peers[0]!,
    {
      type: "shot",
      id: "audio-shot",
      table: table.id,
      turn,
      angle: 0,
      power: 0.2,
    },
    0,
  );
  h.update(INPUT_DT, 0);
  expect(table.sounds.find((s) => s.kind === "cue")?.turn).toBe(turn);
  table.match.phase = "aiming";
  table.match.shotNumber++;
  const p = POCKETS[1]!;
  table.physics.reset([
    { id: 1, x: p.x, z: p.z, vx: 0, vz: 0, pocketed: false },
  ]);
  let sawReturn = false;
  for (let i = 0; i < 180; i++) {
    h.update(INPUT_DT, 0);
    for (const sound of table.sounds.filter((s) => s.kind === "return")) {
      sawReturn = true;
      expect(sound.turn).toBe(turn);
    }
  }
  expect(sawReturn).toBe(true);
});
