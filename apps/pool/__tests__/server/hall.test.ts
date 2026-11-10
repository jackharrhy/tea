import { afterEach, describe, expect, test } from "bun:test";
import { INPUT_DT, parseClientMessage } from "@tea/pool-protocol";
import type { ClientMessage, ServerMessage } from "@tea/pool-protocol";
import {
  TABLES,
  WALK_SPEED,
  STOOLS,
  findPath,
  walkable,
} from "@tea/pool-simulation";
import {
  TABLE_CLEARANCE,
  tableSeatPosition,
  TABLE_JOIN_DISTANCE,
} from "@tea/pool-simulation/geometry";
import { Hall } from "../../server/hall";
import type { Peer } from "../../server/hall";

const halls: Hall[] = [];
function createHall(save?: ConstructorParameters<typeof Hall>[0]) {
  const hall = new Hall(save);
  halls.push(hall);
  return hall;
}
afterEach(() => {
  for (const hall of halls.splice(0)) hall.dispose();
});
function settle(hall: Hall, table: Hall["tables"][number], now: number) {
  for (let i = 0; table.match.phase === "rolling" && i < 2400; i++)
    hall.update(INPUT_DT, now + i * 1000 * INPUT_DT);
  expect(table.match.phase).not.toBe("rolling");
}
function peer() {
  const messages: ServerMessage[] = [];
  const closed: number[] = [];
  return {
    messages,
    closed,
    send: (raw: string) => messages.push(JSON.parse(raw)),
    close: (code = 1000) => closed.push(code),
  };
}
function command(
  hall: Hall,
  id: string,
  socket: Peer,
  message: ClientMessage,
  now = 1000,
) {
  const parsed = parseClientMessage(JSON.stringify(message));
  expect(parsed).not.toBeNull();
  hall.handle(id, socket, parsed!, now);
}
function positionGuest(
  hall: Hall,
  id: string,
  point: { x: number; z: number },
) {
  const guest = hall.guests.get(id)!;
  guest.state.x = hall.world.components.Position.x[guest.eid] = point.x;
  guest.state.z = hall.world.components.Position.z[guest.eid] = point.z;
}
function game(save?: ConstructorParameters<typeof Hall>[0]) {
  const hall = createHall(save);
  const sockets = [peer(), peer()];
  const ids = sockets.map((socket, i) => hall.connect(socket, `Player ${i}`)!);
  const table = hall.tables[0]!;
  for (const i of [0, 1] as const) {
    positionGuest(hall, ids[i]!, tableSeatPosition(table.id, i));
    command(hall, ids[i]!, sockets[i]!, { type: "join", table: table.id });
  }
  const shot = (): Extract<ClientMessage, { type: "shot" }> => ({
    type: "shot",
    id: "shot-1",
    table: table.id,
    turn: table.match.shotNumber,
    angle: 0,
    power: 0.02,
  });
  return { hall, sockets, ids, table, shot };
}

describe("Hall protocol integration", () => {
  test("joining requires the available seat and preserves physical position and revision", () => {
    const hall = createHall();
    for (const spot of TABLES) {
      const table = hall.tables.find((t) => t.id === spot.id)!;
      for (const seat of [0, 1] as const) {
        if (table.match.players[seat]) continue;
        const socket = peer();
        const id = hall.connect(socket, `Player ${spot.id}-${seat}`)!;
        const guest = hall.guests.get(id)!;
        const destination = tableSeatPosition(spot.id, seat);
        const reached = findPath(guest.state, destination).at(-1)!;
        expect(reached.x).toBeCloseTo(destination.x, 12);
        expect(reached.z).toBeCloseTo(destination.z, 12);
        positionGuest(hall, id, tableSeatPosition(spot.id, seat === 0 ? 1 : 0));
        command(hall, id, socket, { type: "join", table: spot.id });
        expect(guest.state.table).toBeNull();
        expect(table.match.players[seat]).toBeNull();
        positionGuest(hall, id, {
          x: destination.x,
          z: destination.z + TABLE_JOIN_DISTANCE + 0.01,
        });
        command(hall, id, socket, { type: "join", table: spot.id });
        expect(guest.state.table).toBeNull();
        const arrival = { x: destination.x, z: destination.z + 0.08 };
        positionGuest(hall, id, arrival);
        const revision = guest.state.revision;
        command(hall, id, socket, { type: "join", table: spot.id });
        expect(guest.state.table).toBe(spot.id);
        expect(guest.state.x).toBe(arrival.x);
        expect(guest.state.z).toBe(arrival.z);
        expect(guest.state.revision).toBe(revision);
        expect(walkable(guest.state.x, guest.state.z)).toBe(true);
        expect(hall.world.components.Position.x[guest.eid]).toBe(guest.state.x);
        expect(hall.world.components.Position.z[guest.eid]).toBe(guest.state.z);
      }
    }
    expect(walkable(hall.bot.x, hall.bot.z)).toBe(true);
    expect(hall.bot.x - TABLES[3]!.x).toBeCloseTo(TABLE_CLEARANCE.x + 0.12);
  });

  test("only the current socket and current shooter can strike; duplicates resolve once", () => {
    const { hall, sockets, ids, table, shot } = game();
    const packet = shot();
    command(hall, ids[1]!, sockets[1]!, packet);
    command(hall, ids[0]!, peer(), packet);
    expect(table.match.phase).toBe("aiming");
    command(hall, ids[0]!, sockets[0]!, packet);
    const velocity = table.balls[0]!.vx;
    command(hall, ids[0]!, sockets[0]!, {
      ...packet,
      id: "another",
      angle: 1,
      power: 1,
    });
    expect(table.balls[0]!.vx).toBe(velocity);
    settle(hall, table, 1000);
    expect(table.match.shotNumber).toBe(2);
    expect(table.match.phase).toBe("ball-in-hand");
    command(hall, ids[0]!, sockets[0]!, packet, 4000);
    expect(table.match.shotNumber).toBe(2);
  });

  test("reconnect revokes the old socket before close and preserves unacknowledged movement sequence", () => {
    const hall = createHall(),
      old = peer(),
      replacement = peer();
    const id = hall.connect(old, "One")!,
      guest = hall.guests.get(id)!;
    command(hall, id, old, { type: "move", inputs: [{ seq: 7, x: 1, z: 0 }] });
    hall.update(INPUT_DT, 1000);
    old.close = () => {
      hall.disconnect(id, old);
      return 0;
    };
    expect(hall.connect(replacement, "Ignored", guest.token)).toBe(id);
    hall.disconnect(id, old);
    command(hall, id, old, { type: "move", inputs: [{ seq: 99, x: 1, z: 0 }] });
    command(hall, id, replacement, {
      type: "move",
      inputs: [{ seq: 6, x: 1, z: 0 }],
    });
    expect(guest.state.connected).toBe(true);
    expect(guest.state.seq).toBe(7);
    expect(guest.input).toMatchObject({ x: 0, z: 0, seq: 7 });
    expect(hall.guests.size).toBe(1);
  });

  test("forfeit saves once, duplicate joins do not restart, and stale turns cannot enter a new rack", () => {
    const saved: string[][] = [];
    const { hall, sockets, ids, table, shot } = game(
      (_table, winner, players) => saved.push([winner, ...players]),
    );
    const oldShot = shot();
    command(hall, ids[1]!, sockets[1]!, { type: "leave" });
    expect(saved).toEqual([[ids[0]!, ...ids]]);
    command(hall, ids[0]!, sockets[0]!, { type: "join", table: table.id });
    expect(table.match.phase).toBe("finished");
    command(hall, ids[0]!, sockets[0]!, { type: "leave" });
    const sent = sockets[1]!.messages.length;
    command(hall, ids[0]!, sockets[0]!, { type: "leave" });
    expect(sockets[1]!.messages).toHaveLength(sent);
    expect(saved).toHaveLength(1);
    expect(table.match.players).toEqual([null, null]);
    for (let i = 0; i < 2; i++)
      command(hall, ids[i]!, sockets[i]!, { type: "join", table: table.id });
    command(hall, ids[0]!, sockets[0]!, oldShot);
    expect(table.match.phase).toBe("aiming");
    expect(table.match.shotNumber).toBeGreaterThan(1);
    expect(table.balls[0]!.vx).toBe(0);
  });

  test("finished games require both current players to request the same rematch", () => {
    const saved: string[] = [];
    const { hall, sockets, ids, table, shot } = game((_table, winner) =>
      saved.push(winner),
    );
    expect(table.match.message).toBe("Opening break.");
    const request = (): ClientMessage => ({
      type: "rematch",
      table: table.id,
      turn: table.match.shotNumber,
    });
    command(hall, ids[0]!, sockets[0]!, request());
    expect(hall.snapshot().tables[0]!.rematchReady).toEqual([]);
    command(hall, ids[0]!, sockets[0]!, shot());
    table.result.potted.push(8);
    settle(hall, table, 2000);
    expect(table.match.phase).toBe("finished");
    expect(saved).toEqual([ids[1]!]);
    const finishedTurn = table.match.shotNumber,
      vote = request();
    command(hall, ids[0]!, sockets[0]!, { type: "join", table: table.id });
    expect(table.match.phase).toBe("finished");
    expect(hall.snapshot().tables[0]!.rematchReady).toEqual([]);
    const spectator = peer(),
      spectatorId = hall.connect(spectator, "Watcher")!;
    command(hall, spectatorId, spectator, vote);
    command(hall, ids[0]!, peer(), vote);
    command(hall, ids[0]!, sockets[0]!, {
      type: "rematch",
      table: "2",
      turn: finishedTurn,
    });
    expect(hall.snapshot().tables[0]!.rematchReady).toEqual([]);
    command(hall, ids[0]!, sockets[0]!, vote);
    command(hall, ids[0]!, sockets[0]!, vote);
    expect(table.match.phase).toBe("finished");
    const snapshot = hall.snapshot();
    expect(snapshot.tables[0]!.rematchReady).toEqual([ids[0]!]);
    snapshot.tables[0]!.rematchReady.push(ids[1]!);
    expect(hall.snapshot().tables[0]!.rematchReady).toEqual([ids[0]!]);
    command(hall, ids[1]!, sockets[1]!, vote, 5000);
    expect(table.match.phase).toBe("aiming");
    expect(table.match.shotNumber).toBe(finishedTurn + 1);
    expect(table.match.message).toBe("Opening break.");
    expect(table.match.winner).toBeNull();
    expect(table.match.groups).toEqual([null, null]);
    expect(
      table.balls.every(
        (ball) => !ball.pocketed && ball.vx === 0 && ball.vz === 0,
      ),
    ).toBe(true);
    expect(table.turnAt).toBe(5000);
    expect(table.saved).toBe(false);
    expect(hall.snapshot().tables[0]!.rematchReady).toEqual([]);
    command(hall, ids[0]!, sockets[0]!, shot(), 5001);
    table.result.potted.push(8);
    settle(hall, table, 6000);
    command(hall, ids[0]!, sockets[0]!, vote);
    command(hall, ids[1]!, sockets[1]!, vote);
    expect(table.match.phase).toBe("finished");
    expect(hall.snapshot().tables[0]!.rematchReady).toEqual([]);
    expect(saved).toEqual([ids[1]!, ids[1]!]);
  });

  test("disconnects and seat changes discard rematch consent; joining cannot restart a finished game", () => {
    const { hall, sockets, ids, table } = game();
    table.match.phase = "finished";
    table.match.winner = ids[0]!;
    const vote: ClientMessage = {
      type: "rematch",
      table: table.id,
      turn: table.match.shotNumber,
    };
    command(hall, ids[0]!, sockets[0]!, vote);
    hall.disconnect(ids[1]!, sockets[1]!);
    expect(hall.snapshot().tables[0]!.rematchReady).toEqual([]);
    command(hall, ids[0]!, sockets[0]!, vote);
    expect(hall.snapshot().tables[0]!.rematchReady).toEqual([]);
    const replacement = peer();
    hall.connect(replacement, "Reconnected", hall.guests.get(ids[1]!)!.token);
    command(hall, ids[1]!, replacement, vote);
    expect(table.match.phase).toBe("finished");
    expect(hall.snapshot().tables[0]!.rematchReady).toEqual([ids[1]!]);
    command(hall, ids[0]!, sockets[0]!, { type: "leave" });
    expect(hall.snapshot().tables[0]!.rematchReady).toEqual([]);
    command(hall, ids[0]!, sockets[0]!, { type: "join", table: table.id });
    expect(table.match.phase).toBe("finished");
    command(hall, ids[0]!, sockets[0]!, vote);
    expect(table.match.phase).toBe("finished");
    command(hall, ids[1]!, replacement, vote);
    expect(hall.snapshot().tables[0]!.match.phase).toBe("aiming");
  });

  test("turn deadline wins command races; placement cannot buy another 90 seconds", () => {
    const { hall, sockets, ids, table, shot } = game();
    command(hall, ids[0]!, sockets[0]!, shot(), 91_000);
    expect(table.match.phase).toBe("ball-in-hand");
    expect(table.match.turn).toBe(1);
    const place: ClientMessage = {
      type: "place",
      table: table.id,
      turn: table.match.shotNumber,
      x: 0,
      z: -1,
    };
    command(hall, ids[0]!, sockets[0]!, place, 100_000);
    expect(table.match.phase).toBe("ball-in-hand");
    command(hall, ids[1]!, sockets[1]!, { ...place, x: 0, z: 0.8 }, 100_000);
    expect(table.match.phase).toBe("ball-in-hand");
    command(hall, ids[1]!, sockets[1]!, place, 180_000);
    expect(table.match.phase).toBe("aiming");
    command(hall, ids[1]!, sockets[1]!, { ...place, z: -1.5 }, 180_000);
    expect(table.balls[0]!.z).toBe(-1);
    hall.update(1 / 60, 181_000);
    expect(table.match.turn).toBe(0);
    expect(table.match.phase).toBe("ball-in-hand");
  });

  test("disconnect grace reserves a seat, then removes identity and records the forfeit", () => {
    const saved: string[] = [];
    const { hall, sockets, ids, table } = game((_table, winner) =>
      saved.push(winner),
    );
    const guest = hall.guests.get(ids[0]!)!,
      token = guest.token;
    hall.disconnect(ids[0]!, sockets[0]!);
    const at = guest.disconnectedAt;
    hall.update(0, at + 59_999);
    expect(table.match.players[0]).toBe(ids[0]!);
    hall.update(0, at + 60_001);
    expect(hall.guests.has(ids[0]!)).toBe(false);
    expect(hall.tokens.has(token)).toBe(false);
    expect(table.match.players[0]).toBeNull();
    expect(saved).toEqual([ids[1]!]);
    const replacement = hall.connect(peer(), "New", token);
    expect(replacement).not.toBe(ids[0]!);
  });

  test("movement expires, seating requires proximity, and disconnected guests count toward capacity", () => {
    const hall = createHall(),
      socket = peer(),
      id = hall.connect(socket, "Walker")!;
    const guest = hall.guests.get(id)!;
    command(hall, id, socket, { type: "join", table: "1" });
    expect(guest.state.table).toBeNull();
    command(hall, id, socket, {
      type: "move",
      inputs: [{ seq: 1, x: 1, z: 1 }],
    });
    const start = { ...guest.state };
    hall.update(1 / 60, 1100);
    expect(
      Math.hypot(guest.state.x - start.x, guest.state.z - start.z),
    ).toBeCloseTo(WALK_SPEED / 60);
    const stopped = { ...guest.state };
    hall.update(1 / 60, 1300);
    expect(guest.state.x).toBe(stopped.x);
    hall.disconnect(id, socket);
    for (let i = 1; i < 32; i++) hall.connect(peer(), `Guest ${i}`);
    const overflow = peer();
    expect(hall.connect(overflow, "Overflow")).toBeNull();
    expect(overflow.closed).toEqual([1013]);
    expect(hall.connect(peer(), "Rejoin", guest.token)).toBe(id);
    expect(hall.guests.size).toBe(32);
    expect(() => hall.update(Infinity)).toThrow(RangeError);
  });
});

function botGame(save?: ConstructorParameters<typeof Hall>[0]) {
  const hall = createHall(save),
    socket = peer();
  const id = hall.connect(socket, "Solo player")!;
  const guest = hall.guests.get(id)!;
  positionGuest(hall, id, tableSeatPosition("4", 0));
  const table = hall.tables.find((t) => t.id === hall.bot.table)!;
  command(hall, id, socket, { type: "join", table: table.id });
  return { hall, socket, id, guest, table };
}

describe("house bot", () => {
  test("reserves one table without using guest capacity, then places and shoots through normal physics", () => {
    const idle = createHall();
    idle.update(0, Date.now() + 120_000);
    expect(idle.guests.size).toBe(0);
    expect(idle.tokens.size).toBe(0);
    expect(idle.snapshot().players).toEqual([{ ...idle.bot }]);
    expect(
      idle.tables.filter((t) => t.match.players.some(Boolean)),
    ).toHaveLength(1);
    const { hall, socket, id, table } = botGame();
    expect(table.match.players).toEqual([id, hall.bot.id]);
    expect(table.match.turn).toBe(0);
    command(hall, id, socket, {
      type: "shot",
      id: "solo-break",
      table: table.id,
      turn: table.match.shotNumber,
      angle: 0,
      power: 0.02,
    });
    for (let tick = 0; table.match.phase === "rolling" && tick < 600; tick++)
      hall.update(1 / 60, 1000 + tick * 17);
    expect(table.match.phase).toBe("ball-in-hand");
    expect(table.match.turn).toBe(1);
    const at = table.turnAt;
    hall.update(0, at + 699);
    expect(table.match.phase).toBe("ball-in-hand");
    hall.update(0, at + 700);
    expect(table.match.phase).toBe("aiming");
    expect(table.balls[0]!.pocketed).toBe(false);
    hall.update(0, at + 1400);
    expect(table.match.phase).toBe("rolling");
    expect(Math.hypot(table.balls[0]!.vx, table.balls[0]!.vz)).toBeGreaterThan(
      0,
    );
    for (let tick = 0; table.match.phase === "rolling" && tick < 1200; tick++)
      hall.update(1 / 60, at + 1400 + tick * 17);
    expect(table.match.shotNumber).toBe(3);
    expect(table.result.firstContact).not.toBeNull();
    expect(table.result.firstContact).not.toBe(8);
  });

  test("pauses for a disconnected opponent and resets for the next visitor after grace expires", () => {
    const { hall, socket, id, guest, table } = botGame();
    table.match.turn = 1;
    hall.disconnect(id, socket);
    hall.update(0, 3000);
    expect(table.match.phase).toBe("aiming");
    const replacement = peer();
    expect(hall.connect(replacement, "Rejoined", guest.token)).toBe(id);
    hall.update(0, 3001);
    expect(table.match.phase).toBe("rolling");
    hall.disconnect(id, replacement);
    const oldTurn = table.match.shotNumber;
    hall.update(0, guest.disconnectedAt + 60_001);
    expect(table.match.phase).toBe("waiting");
    expect(table.match.players).toEqual([null, hall.bot.id]);
    const next = peer(),
      nextId = hall.connect(next, "Next player")!;
    positionGuest(hall, nextId, tableSeatPosition(table.id, 0));
    command(hall, nextId, next, { type: "join", table: table.id });
    expect(table.match.phase).toBe("aiming");
    expect(table.match.players).toEqual([nextId, hall.bot.id]);
    expect(table.match.shotNumber).toBeGreaterThan(oldTurn);
  });

  test("accepts a solo rematch and keeps the bot seated when the human leaves", () => {
    const saved: string[] = [];
    const { hall, socket, id, table } = botGame((_table, winner) =>
      saved.push(winner),
    );
    command(hall, id, socket, {
      type: "shot",
      id: "illegal-eight",
      table: table.id,
      turn: table.match.shotNumber,
      angle: 0,
      power: 0.02,
    });
    table.result.potted.push(8);
    settle(hall, table, 2000);
    expect(table.match.phase).toBe("finished");
    expect(saved).toEqual([hall.bot.id]);
    expect(
      hall.snapshot().tables.find((t) => t.id === table.id)!.rematchReady,
    ).toEqual([hall.bot.id]);
    const turn = table.match.shotNumber;
    command(hall, id, socket, { type: "rematch", table: table.id, turn }, 3000);
    expect(table.match.phase).toBe("aiming");
    expect(table.match.shotNumber).toBeGreaterThan(turn);
    command(hall, id, socket, { type: "leave" });
    expect(table.match.phase).toBe("waiting");
    expect(table.match.players).toEqual([null, hall.bot.id]);
    expect(saved).toHaveLength(2);
    expect(
      table.balls.every((b) => !b.pocketed && b.vx === 0 && b.vz === 0),
    ).toBe(true);
  });
});

test("movement batches are applied once per fixed tick and acknowledged only after collision simulation", () => {
  const hall = createHall(),
    socket = peer(),
    id = hall.connect(socket, "Walker")!;
  const guest = hall.guests.get(id)!;
  const from = { x: guest.state.x, z: guest.state.z };
  const packet: ClientMessage = {
    type: "move",
    inputs: [1, 2, 3].map((seq) => ({ seq, x: 1, z: 0 })),
  };
  command(hall, id, socket, packet);
  command(hall, id, socket, packet);
  expect(guest.state.seq).toBe(0);
  expect(guest.queue).toHaveLength(3);
  hall.update(INPUT_DT, 1000);
  expect(guest.state.seq).toBe(1);
  expect(guest.state.x - from.x).toBeCloseTo(WALK_SPEED * INPUT_DT);
  hall.update(INPUT_DT, 1017);
  hall.update(INPUT_DT, 1034);
  expect(guest.state.seq).toBe(3);
  expect(guest.state.x - from.x).toBeCloseTo(WALK_SPEED * INPUT_DT * 3);
  const stopped = guest.state.x;
  hall.update(INPUT_DT, 1051);
  expect(guest.state.x).toBe(stopped);
  command(hall, id, socket, {
    type: "move",
    inputs: [{ seq: 2, x: -1, z: 0 }],
  });
  hall.update(INPUT_DT, 1068);
  expect(guest.state.x).toBe(stopped);
});

test("expired and overflowed inputs retire explicitly without simulating or resurrecting them", () => {
  const hall = createHall(),
    socket = peer(),
    id = hall.connect(socket, "Delayed walker")!;
  const guest = hall.guests.get(id)!;
  const origin = guest.state.x;
  command(
    hall,
    id,
    socket,
    {
      type: "move",
      inputs: Array.from({ length: 6 }, (_, i) => ({ seq: i + 1, x: 1, z: 0 })),
    },
    1000,
  );
  hall.update(INPUT_DT, 1501);
  expect(guest.state).toMatchObject({ x: origin, seq: 0, retiredSeq: 6 });
  command(
    hall,
    id,
    socket,
    { type: "move", inputs: [{ seq: 7, x: 1, z: 0 }] },
    1600,
  );
  command(
    hall,
    id,
    socket,
    { type: "move", inputs: [{ seq: 8, x: 0, z: 0 }] },
    2200,
  );
  hall.update(INPUT_DT, 2201);
  expect(guest.state).toMatchObject({ x: origin, seq: 8, retiredSeq: 7 });
  for (let batch = 0; batch < 6; batch++)
    command(
      hall,
      id,
      socket,
      {
        type: "move",
        inputs: Array.from({ length: 6 }, (_, i) => ({
          seq: 9 + batch * 6 + i,
          x: 1,
          z: 0,
        })),
      },
      3000,
    );
  expect(guest.queue).toHaveLength(30);
  expect(guest.state.retiredSeq).toBe(14);
  hall.update(INPUT_DT, 3001);
  expect(guest.state.seq).toBe(15);
  expect(guest.state.x - origin).toBeCloseTo(WALK_SPEED * INPUT_DT);
});

test("shot acknowledgment preserves its identity and strike time across retries, without another strike", () => {
  const { hall, sockets, ids, table, shot } = game();
  const packet = shot();
  command(hall, ids[1]!, sockets[1]!, packet);
  expect(sockets[1]!.messages.at(-1)).toMatchObject({
    type: "shot-ack",
    id: packet.id,
    accepted: false,
  });
  command(hall, ids[0]!, sockets[0]!, packet);
  const first = [...sockets[0]!.messages]
    .toReversed()
    .find((m) => m.type === "shot-ack");
  expect(first).toMatchObject({
    type: "shot-ack",
    id: packet.id,
    turn: packet.turn,
    accepted: true,
    time: 0,
  });
  hall.update(INPUT_DT, 1001);
  const before = structuredClone(table.balls);
  command(hall, ids[0]!, sockets[0]!, { ...packet, power: 1, angle: 1 }, 1002);
  expect(table.balls).toEqual(before);
  expect(sockets[0]!.messages.at(-1)).toEqual(first);
  settle(hall, table, 1010);
  const turn = table.match.shotNumber;
  command(hall, ids[0]!, sockets[0]!, packet, 5000);
  expect(sockets[0]!.messages.at(-1)).toEqual(first);
  expect(table.match.shotNumber).toBe(turn);
  command(hall, ids[1]!, sockets[1]!, { ...packet, id: "stale" }, 5001);
  expect(sockets[1]!.messages.at(-1)).toMatchObject({
    type: "shot-ack",
    id: "stale",
    accepted: false,
  });
});

test("chosen avatar colour is shared and can be changed when resuming the same guest", () => {
  const hall = createHall();
  const original = peer();
  const id = hall.connect(original, "Colour picker", undefined, 0x39c2b4)!;
  const guest = hall.guests.get(id)!;
  expect(hall.snapshot().players.find((p) => p.id === id)?.color).toBe(
    0x39c2b4,
  );
  expect(hall.connect(peer(), "Colour picker", guest.token, 0x8258dd)).toBe(id);
  expect(hall.snapshot().players.find((p) => p.id === id)?.color).toBe(
    0x8258dd,
  );
  expect(hall.connect(peer(), "Colour picker", guest.token)).toBe(id);
  expect(guest.state.color).toBe(0x8258dd);
});

function moveTo(hall: Hall, id: string, x: number, z: number) {
  const guest = hall.guests.get(id)!;
  guest.state.x = hall.world.components.Position.x[guest.eid] = x;
  guest.state.z = hall.world.components.Position.z[guest.eid] = z;
  return guest;
}

describe("stool seating", () => {
  test("requires proximity, reserves one stool and stands on movement", () => {
    const hall = createHall(),
      a = peer(),
      b = peer();
    const first = hall.connect(a, "First")!,
      second = hall.connect(b, "Second")!;
    const seat = STOOLS[0]!;
    command(hall, first, a, { type: "sit", seat: seat.id });
    expect(hall.guests.get(first)!.state.seat).toBeUndefined();
    const guest = moveTo(hall, first, seat.x - 0.1, seat.z);
    command(hall, first, a, { type: "sit", seat: seat.id });
    const revision = guest.state.revision;
    expect(guest.state).toMatchObject({
      seat: seat.id,
      x: seat.x,
      z: seat.z,
      yaw: seat.yaw,
    });
    command(hall, first, a, { type: "sit", seat: seat.id });
    expect(guest.state.revision).toBe(revision);
    moveTo(hall, second, seat.x - 0.2, seat.z);
    command(hall, second, b, { type: "sit", seat: seat.id });
    expect(hall.guests.get(second)!.state.seat).toBeUndefined();
    expect(b.messages.at(-1)).toMatchObject({
      type: "error",
      text: "Someone is sitting there.",
    });
    command(hall, first, a, { type: "move", inputs: [{ seq: 1, x: 0, z: 0 }] });
    hall.update(INPUT_DT, 1000);
    expect(guest.state.seat).toBe(seat.id);
    command(hall, first, a, {
      type: "move",
      inputs: [{ seq: 2, x: -1, z: 0 }],
    });
    hall.update(INPUT_DT, 1000);
    expect(guest.state.seat).toBeUndefined();
    expect(guest.state.x).toBeLessThan(seat.x);
    command(hall, second, b, { type: "sit", seat: seat.id });
    expect(hall.guests.get(second)!.state.seat).toBe(seat.id);
    hall.disconnect(second, b);
    expect(hall.guests.get(second)!.state.seat).toBeUndefined();
    command(hall, first, a, { type: "sit", seat: seat.id });
    expect(guest.state.seat).toBe(seat.id);
    command(hall, first, a, { type: "stand" });
    expect(guest.state.seat).toBeUndefined();
  });
  test("all stools support seating and old sockets cannot change a seat", () => {
    const hall = createHall(),
      socket = peer();
    const id = hall.connect(socket, "Seated")!;
    for (const seat of STOOLS) {
      const guest = moveTo(hall, id, seat.x, seat.z);
      command(hall, id, socket, { type: "sit", seat: seat.id });
      hall.update(INPUT_DT, 1000);
      expect(guest.state.seat).toBe(seat.id);
    }
    const guest = hall.guests.get(id)!;
    const replacement = peer();
    hall.connect(replacement, "Seated", guest.token);
    command(hall, id, socket, { type: "stand" });
    hall.disconnect(id, socket);
    expect(guest.state.seat).toBe(STOOLS.at(-1)!.id);
    command(hall, id, replacement, { type: "stand" });
    expect(guest.state.seat).toBeUndefined();
  });
});
