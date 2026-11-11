import { PoolPhysics } from "@harrhy/pool/engine";
import type { GameRecorder } from "./recordings";
import {
  tableSeatPosition,
  TABLE_JOIN_DISTANCE,
  HALL_SPAWN,
} from "@harrhy/pool-simulation/geometry";
import { INPUT_DT, roomSettingsSchema } from "@harrhy/pool-protocol";
import type { MoveInput } from "@harrhy/pool-protocol";
import { chooseBotShot, chooseBotPlacement } from "./bot";
import {
  createShotResult,
  TABLE_HALF_WIDTH,
  TABLE_HALF_LENGTH,
  BALL_RADIUS,
  createMatch,
  startMatch,
  resolveShot,
} from "@harrhy/pool";
import type { PhysicalBall, PoolMatch, ShotResult } from "@harrhy/pool";
import {
  TABLES,
  STOOLS,
  createMovementWorld,
  addAvatar,
  removeAvatar,
  stepAvatar,
} from "@harrhy/pool-simulation";
import type {
  ClientMessage,
  RoomSettings,
  CuePresence,
  PlayerState,
  ServerMessage,
  Snapshot,
  TableSound,
} from "@harrhy/pool-protocol";

const MOVEMENT_WINDOW_MS = 500;
const MAX_QUEUED_INPUTS = Math.round(MOVEMENT_WINDOW_MS / (INPUT_DT * 1000));

export type Peer = {
  send: (message: string) => unknown;
  close: (code?: number, reason?: string) => unknown;
  getBufferedAmount?: () => number;
};
type Guest = {
  state: PlayerState;
  token: string;
  eid: number;
  peer: Peer | null;
  input: { x: number; z: number; seq: number; at: number };
  queue: (MoveInput & { at: number })[];
  receivedSeq: number;
  disconnectedAt: number;
  lastChat: number;
  traceAt: number;
  diagnosticsAt: number;
  diagnosticsCount: number;
};
type GameTable = {
  id: string;
  readonly balls: PhysicalBall[];
  physics: PoolPhysics;
  rack: number;
  sounds: TableSound[];
  nextSoundId: number;
  soundTurn: number;
  match: PoolMatch;
  result: ShotResult;
  lastCommand: {
    id: string;
    player: string;
    turn: number;
    time: number;
  } | null;
  turnAt: number;
  cue: CuePresence | null;
  cueAt: number;
  saved: boolean;
  rematchReady: Set<string>;
};
const COLORS = [
  0xe8a65d, 0x70b8ac, 0xcc8183, 0x9faada, 0xd2c26f, 0xb28bc1, 0x88b778,
];
export class Hall {
  readonly world = createMovementWorld();
  readonly guests = new Map<string, Guest>();
  readonly tokens = new Map<string, string>();
  readonly tables: GameTable[] = TABLES.map((t) => {
    const physics = new PoolPhysics();
    return {
      id: t.id,
      physics,
      get balls() {
        return physics.balls;
      },
      rack: 0,
      sounds: [],
      nextSoundId: 0,
      soundTurn: 0,
      match: createMatch(),
      result: createShotResult(),
      lastCommand: null,
      turnAt: 0,
      cue: null,
      cueAt: 0,
      saved: false,
      rematchReady: new Set<string>(),
    };
  });
  readonly bot: PlayerState = {
    id: "house-bot",
    name: "Moss (bot)",
    bot: true,
    ...tableSeatPosition("4", 1),
    yaw: -Math.PI / 2,
    color: 0x88b778,
    table: "4",
    connected: true,
    seq: 0,
    revision: 0,
    retiredSeq: 0,
  };
  private updateDraining = false;
  private roomSettings: RoomSettings = {
    lightIntensity: 1,
    gravity: [0, -9.81, 0],
    cutaway: false,
  };
  adminPlayers() {
    return [...this.guests.values()]
      .map((guest) => guest.state)
      .concat(this.bot)
      .map(({ id, name, connected, bot }) => ({ id, name, connected, bot }));
  }
  getRoomSettings(): RoomSettings {
    return { ...this.roomSettings, gravity: [...this.roomSettings.gravity] };
  }
  hasActiveHumanMatch(): boolean {
    return this.tables.some(
      (table) =>
        table.match.phase !== "waiting" &&
        table.match.phase !== "finished" &&
        table.match.players.some(
          (id) => id && id !== this.bot.id && this.guests.get(id)?.peer,
        ),
    );
  }
  drainForUpdate(): boolean {
    if (
      this.tables.some(
        (table) =>
          table.match.phase !== "waiting" && table.match.phase !== "finished",
      )
    )
      return false;
    // Synchronous with join/rematch handling: no match can enter between this check and admission closure.
    this.updateDraining = true;
    return true;
  }
  resumeAfterUpdate(): void {
    this.updateDraining = false;
  }
  setRoomSettings(next: RoomSettings): boolean {
    const parsed = roomSettingsSchema.safeParse(next);
    if (!parsed.success) return false;
    next = parsed.data;
    const gravityChanged = next.gravity.some(
      (value, index) => value !== this.roomSettings.gravity[index],
    );
    if (gravityChanged && this.hasActiveHumanMatch()) return false;
    this.roomSettings = next;
    if (gravityChanged) {
      for (const table of this.tables) {
        this.recorder?.recordGravityChange(table.id, next.gravity, this.tick);
        table.physics.setGravity(next.gravity);
      }
    }
    this.broadcast({ type: "room-settings", settings: this.getRoomSettings() });
    return true;
  }
  renamePlayer(id: string, name: string): boolean {
    name = name.trim();
    if (!name || name.length > 24 || /[\p{Cc}<>]/u.test(name)) return false;
    const player = id === this.bot.id ? this.bot : this.guests.get(id)?.state;
    if (!player) return false;
    player.name = name;
    this.broadcast(this.snapshot());
    return true;
  }
  tick = 0;
  private snapshotTime = -Infinity;
  constructor(
    private saveResult: (
      table: string,
      winner: string,
      players: string[],
    ) => void = () => {},
    private recorder?: GameRecorder,
  ) {
    const table = this.tables.find((t) => t.id === this.bot.table)!;
    table.match.players[1] = this.bot.id;
    table.match.message = "Moss (bot) is ready for a game.";
  }
  send(peer: Peer, message: ServerMessage) {
    if ((peer.getBufferedAmount?.() ?? 0) > 512_000) {
      peer.close(1013, "Connection fell behind. Reconnect to catch up.");
      return;
    }
    peer.send(JSON.stringify(message));
  }
  private acknowledgeShot(
    peer: Peer,
    shot: Extract<ClientMessage, { type: "shot" }>,
    accepted: boolean,
    time: number,
    text?: string,
  ) {
    this.send(peer, {
      type: "shot-ack",
      id: shot.id,
      table: shot.table,
      turn: shot.turn,
      accepted,
      time,
      ...(text ? { text } : {}),
    });
  }
  error(peer: Peer, text: string) {
    this.send(peer, { type: "error", text });
  }
  connect(
    peer: Peer,
    name: string,
    token?: string,
    color?: number,
  ): string | null {
    const existing = token
      ? this.guests.get(this.tokens.get(token) ?? "")
      : undefined;
    if (existing) {
      const previous = existing.peer;
      existing.peer = peer;
      existing.state.connected = true;
      if (color !== undefined) existing.state.color = color;
      existing.disconnectedAt = 0;
      existing.state.seq = existing.input.seq;
      this.clearInputs(existing);
      existing.receivedSeq = Math.max(
        existing.state.seq,
        existing.state.retiredSeq,
      );
      existing.input = { x: 0, z: 0, seq: existing.state.seq, at: Date.now() };
      if (previous && previous !== peer)
        previous.close(4001, "Opened in another tab.");
      this.send(peer, {
        type: "welcome",
        id: existing.state.id,
        token: existing.token,
      });
      this.send(peer, this.snapshot());
      return existing.state.id;
    }
    if (this.guests.size >= 32) {
      this.error(peer, "The hall is full. Try again shortly.");
      peer.close(1013, "Hall full");
      return null;
    }
    const clean =
      name
        .replace(/[\p{Cc}<>]/gu, "")
        .trim()
        .slice(0, 24) || "Guest";
    const id = crypto.randomUUID(),
      session = crypto.randomUUID();
    const eid = addAvatar(
      this.world,
      HALL_SPAWN.x - (this.guests.size % 5) * 0.25,
      HALL_SPAWN.z,
    );
    const state: PlayerState = {
      id,
      name: clean,
      x: this.world.components.Position.x[eid],
      z: HALL_SPAWN.z,
      yaw: 0,
      color: color ?? COLORS[this.guests.size % COLORS.length],
      table: null,
      connected: true,
      seq: 0,
      revision: 0,
      retiredSeq: 0,
    };
    this.guests.set(id, {
      state,
      token: session,
      eid,
      peer,
      input: { x: 0, z: 0, seq: 0, at: 0 },
      queue: [],
      receivedSeq: 0,
      disconnectedAt: 0,
      lastChat: 0,
      traceAt: -Infinity,
      diagnosticsAt: 0,
      diagnosticsCount: 0,
    });
    this.tokens.set(session, id);
    this.send(peer, { type: "welcome", id, token: session });
    this.send(peer, this.snapshot());
    return id;
  }
  disconnect(id: string, peer: Peer) {
    const guest = this.guests.get(id);
    if (!guest || guest.peer !== peer) return;
    const table = this.tables.find((t) => t.id === guest.state.table);
    table?.rematchReady.clear();
    if (table?.cue?.player === id) table.cue = null;
    guest.peer = null;
    guest.state.connected = false;
    delete guest.state.seat;
    guest.disconnectedAt = Date.now();
    this.clearInputs(guest);
  }
  leave(guest: Guest) {
    const table = this.tables.find((t) => t.id === guest.state.table);
    this.clearInputs(guest);
    if (!table) {
      guest.state.table = null;
      return;
    }
    if (table.cue?.player === guest.state.id) table.cue = null;
    const index = table.match.players.indexOf(guest.state.id);
    if (index < 0) {
      guest.state.table = null;
      return;
    }
    table.rematchReady.clear();
    const other = table.match.players[1 - index];
    if (
      other &&
      table.match.phase !== "waiting" &&
      table.match.phase !== "finished"
    ) {
      table.match.phase = "finished";
      table.match.winner = other;
      table.match.message = `${guest.state.name} left the table.`;
      this.record(table);
    }
    table.match.players[index] = null;
    guest.state.table = null;
    if (
      table.match.players.every((player) => !player || player === this.bot.id)
    ) {
      const nextTurn = table.match.shotNumber + 1;
      table.match = createMatch();
      table.match.shotNumber = nextTurn;
      if (table.id === this.bot.table) {
        table.match.players[1] = this.bot.id;
        table.match.message = "Moss (bot) is ready for a game.";
      }
      table.physics.reset();
      table.sounds = [];
      table.rack++;
      table.result = createShotResult();
      table.saved = false;
      table.lastCommand = null;
    } else if (table.match.phase === "waiting")
      table.match.message = "Waiting for another player.";
  }
  private clearInputs(guest: Guest) {
    const last = guest.queue.at(-1);
    if (last)
      guest.state.retiredSeq = Math.max(guest.state.retiredSeq, last.seq);
    guest.queue = [];
    guest.input.x = guest.input.z = 0;
  }
  private expireInputs(guest: Guest, now: number) {
    while (guest.queue.length && now - guest.queue[0].at > MOVEMENT_WINDOW_MS)
      guest.state.retiredSeq = Math.max(
        guest.state.retiredSeq,
        guest.queue.shift()!.seq,
      );
  }
  handle(id: string, peer: Peer, message: ClientMessage, now = Date.now()) {
    const guest = this.guests.get(id);
    if (!guest || guest.peer !== peer) return;
    if (message.type === "pool-trace") {
      if (now - guest.traceAt < 30_000) return;
      guest.traceAt = now;
      const table = this.tables.find(
        (candidateTable) => candidateTable.id === guest.state.table,
      );
      if (
        !table ||
        message.table !== table.id ||
        !table.match.players.includes(id)
      )
        return;
      this.recorder?.clientTrace(message, {
        playerId: id,
        seat: table.match.players.indexOf(id),
        tick: this.tick,
      });
      return;
    }
    if (message.type === "diagnostic") {
      if (now - guest.diagnosticsAt >= 10000) {
        guest.diagnosticsAt = now;
        guest.diagnosticsCount = 0;
      }
      if (++guest.diagnosticsCount > 4) return;
      const table = this.tables.find(
        (candidateTable) => candidateTable.id === guest.state.table,
      );
      if (
        message.kind === "pool" &&
        (message.table !== table?.id || !table.match.players.includes(id))
      )
        return;
      this.recorder?.clientDiagnostic(message, {
        playerId: id,
        seat: table?.match.players.indexOf(id) ?? -1,
        tick: this.tick,
      });
      return;
    }
    if (message.type === "move") {
      this.expireInputs(guest, now);
      for (const input of message.inputs) {
        if (input.seq <= guest.receivedSeq) continue;
        guest.receivedSeq = input.seq;
        guest.input.at = now;
        guest.queue.push({ ...input, at: now });
        if (guest.queue.length > MAX_QUEUED_INPUTS)
          guest.state.retiredSeq = guest.queue.shift()!.seq;
      }
      return;
    }
    if (message.type === "ping") {
      this.send(peer, { type: "pong", time: message.time });
      return;
    }
    if (message.type === "chat") {
      if (now - guest.lastChat < 750) return;
      guest.lastChat = now;
      const text = message.text.replace(/\p{Cc}/gu, "").trim();
      if (text)
        this.broadcast({
          type: "chat",
          name: guest.state.name,
          text,
          time: now,
        });
      return;
    }
    if (message.type === "stand") {
      delete guest.state.seat;
      return;
    }
    if (message.type === "sit") {
      if (guest.state.table) {
        this.error(peer, "Leave your table before sitting.");
        return;
      }
      const seat = STOOLS.find((s) => s.id === message.seat);
      if (!seat) return;
      if (Math.hypot(guest.state.x - seat.x, guest.state.z - seat.z) > 0.45) {
        this.error(peer, "Walk closer to the stool.");
        return;
      }
      if (
        [...this.guests.values()].some(
          (g) => g !== guest && g.state.seat === seat.id,
        )
      ) {
        this.error(peer, "Someone is sitting there.");
        return;
      }
      if (guest.state.seat === seat.id) return;
      this.clearInputs(guest);
      guest.state.seat = seat.id;
      guest.state.x = this.world.components.Position.x[guest.eid] = seat.x;
      guest.state.z = this.world.components.Position.z[guest.eid] = seat.z;
      guest.state.yaw = seat.yaw;
      guest.state.revision++;
      this.broadcast(this.snapshot());
      return;
    }
    if (message.type === "leave") {
      if (!guest.state.table) return;
      this.leave(guest);
      this.broadcast(this.snapshot());
      return;
    }
    if (
      this.updateDraining &&
      (message.type === "join" || message.type === "rematch")
    ) {
      this.error(peer, "The hall is preparing an update. Try again shortly.");
      return;
    }
    if (message.type === "join") {
      const table = this.tables.find((t) => t.id === message.table);
      const spot = TABLES.find((t) => t.id === message.table);
      if (!table || !spot) return;
      if (guest.state.table && guest.state.table !== table.id) {
        this.error(peer, "Leave your current table first.");
        return;
      }
      if (guest.state.table === table.id) return;
      let seat = table.match.players.indexOf(id);
      if (seat < 0) seat = table.match.players.indexOf(null);
      if (seat < 0) {
        this.send(peer, this.snapshot());
        this.send(peer, { type: "approach", table: table.id });
        return;
      }
      const position = tableSeatPosition(table.id, seat as 0 | 1);
      if (
        Math.hypot(guest.state.x - position.x, guest.state.z - position.z) >
        TABLE_JOIN_DISTANCE
      ) {
        this.send(peer, this.snapshot());
        this.send(peer, { type: "approach", table: table.id });
        return;
      }
      table.rematchReady.clear();
      table.match.players[seat] = id;
      guest.state.table = table.id;
      delete guest.state.seat;
      this.clearInputs(guest);
      guest.state.yaw = seat === 0 ? Math.PI / 2 : -Math.PI / 2;
      guest.input.x = guest.input.z = 0;
      if (
        table.match.phase !== "finished" &&
        table.match.players.every(Boolean)
      ) {
        this.start(table, now);
      } else if (table.match.phase !== "finished") {
        table.match.phase = "waiting";
        table.match.message = "Waiting for another player.";
      }
      this.broadcast(this.snapshot());
      return;
    }
    const table = this.tables.find((t) => t.id === guest.state.table);
    if (!table) {
      if (message.type === "shot")
        this.acknowledgeShot(
          peer,
          message,
          false,
          this.tick * INPUT_DT * 1000,
          "Join a table before taking a shot.",
        );
      return;
    }
    if (message.type === "rematch") {
      if (
        message.table !== table.id ||
        message.turn !== table.match.shotNumber ||
        table.match.phase !== "finished" ||
        !table.match.players.includes(id) ||
        !table.match.players.every(
          (player) =>
            player && (player === this.bot.id || this.guests.get(player)?.peer),
        )
      )
        return;
      if (table.rematchReady.has(id)) return;
      table.rematchReady.add(id);
      if (table.match.players.includes(this.bot.id))
        table.rematchReady.add(this.bot.id);
      if (
        table.match.players.every(
          (player) => player && table.rematchReady.has(player),
        )
      )
        this.start(table, now);
      this.broadcast(this.snapshot());
      return;
    }
    if (message.type === "cue") {
      this.expireTurn(table, now);
      if (
        message.table !== table.id ||
        table.match.players[table.match.turn] !== id ||
        message.turn !== table.match.shotNumber
      )
        return;
      const point = message.placement;
      if (table.match.phase === "ball-in-hand" && point === null) {
        table.cue = null;
        return;
      }
      if (
        table.match.phase === "aiming"
          ? point !== null
          : table.match.phase !== "ball-in-hand" ||
            point === null ||
            Math.abs(point.x) > TABLE_HALF_WIDTH - BALL_RADIUS ||
            Math.abs(point.z) > TABLE_HALF_LENGTH - BALL_RADIUS
      )
        return;
      table.cue = {
        player: id,
        turn: message.turn,
        angle: message.angle,
        power: message.power,
        placement: point && { ...point },
        at: this.tick * INPUT_DT * 1000,
      };
      table.cueAt = now;
      return;
    }
    if (message.type !== "shot" && message.type !== "place") return;
    if (message.type === "shot" && table.lastCommand?.id === message.id) {
      const accepted =
        table.lastCommand.player === id &&
        table.lastCommand.turn === message.turn &&
        message.table === table.id;
      this.acknowledgeShot(peer, message, accepted, table.lastCommand.time);
      return;
    }
    this.expireTurn(table, now);
    if (
      message.table !== table.id ||
      table.match.players[table.match.turn] !== id ||
      message.turn !== table.match.shotNumber
    ) {
      if (message.type === "shot")
        this.acknowledgeShot(
          peer,
          message,
          false,
          this.tick * INPUT_DT * 1000,
          "The turn changed. Try again.",
        );
      else this.error(peer, "The turn changed. Try again.");
      return;
    }
    if (message.type === "place") {
      if (table.match.phase !== "ball-in-hand") return;
      if (!table.physics.placeCue(message.x, message.z)) {
        this.error(peer, "Place the cue ball on clear felt.");
        return;
      }
      table.cue = null;
      table.match.phase = "aiming";
      table.match.message = "Cue ball placed. Take your shot.";
      this.broadcast(this.snapshot());
      return;
    }
    if (table.match.phase !== "aiming") {
      this.acknowledgeShot(
        peer,
        message,
        false,
        this.tick * INPUT_DT * 1000,
        "Wait for your next shot.",
      );
      return;
    }
    table.cue = null;
    table.lastCommand = {
      id: message.id,
      player: id,
      turn: message.turn,
      time: this.tick * INPUT_DT * 1000,
    };
    this.acknowledgeShot(peer, message, true, table.lastCommand.time);
    this.shoot(table, message.angle, message.power, message.id);
  }
  private shoot(table: GameTable, angle: number, power: number, id?: string) {
    table.cue = null;
    table.result = createShotResult();
    this.recorder?.startShot(
      table.id,
      {
        id,
        number: table.match.shotNumber,
        seat: table.match.turn,
        bot: table.match.players[table.match.turn] === this.bot.id,
        angle,
        power,
      },
      table.balls,
      this.roomSettings.gravity,
      table.rack,
    );
    table.soundTurn = table.match.shotNumber;
    table.physics.strike(angle, power);
    table.match.phase = "rolling";
    table.match.message = "Balls rolling.";
    this.broadcast(this.snapshot());
  }
  private updateBot(table: GameTable, now: number) {
    if (!table.match.players.includes(this.bot.id)) return;
    if (table.match.phase === "finished") {
      table.rematchReady.add(this.bot.id);
      return;
    }
    const seat = table.match.players.indexOf(this.bot.id) as 0 | 1;
    const opponent = table.match.players[1 - seat];
    if (
      !opponent ||
      !this.guests.get(opponent)?.peer ||
      table.match.players[table.match.turn] !== this.bot.id
    )
      return;
    const elapsed = now - table.turnAt;
    if (table.match.phase === "ball-in-hand" && elapsed >= 250) {
      const point =
        table.cue?.player === this.bot.id && table.cue.placement
          ? table.cue.placement
          : chooseBotPlacement(table.balls, table.match, seat);
      table.cue = {
        player: this.bot.id,
        turn: table.match.shotNumber,
        angle: 0,
        power: 0,
        placement: point,
        at: this.tick * INPUT_DT * 1000,
      };
      table.cueAt = now;
      if (elapsed >= 700 && table.physics.placeCue(point.x, point.z)) {
        table.cue = null;
        table.match.phase = "aiming";
        table.match.message = "Moss (bot) is lining up a shot.";
      }
    }
    if (table.match.phase === "aiming" && elapsed >= 700) {
      const shot =
        table.cue?.player === this.bot.id && !table.cue.placement
          ? table.cue
          : chooseBotShot(table.balls, table.match, seat);
      table.cue = {
        player: this.bot.id,
        turn: table.match.shotNumber,
        angle: shot.angle,
        power: shot.power,
        placement: null,
        at: this.tick * INPUT_DT * 1000,
      };
      table.cueAt = now;
      if (elapsed >= 1400) this.shoot(table, shot.angle, shot.power);
    }
  }

  private start(table: GameTable, now: number) {
    // Keep turn tokens unique across racks so delayed commands cannot replay.
    const nextTurn = table.match.shotNumber + 1;
    table.physics.reset();
    table.sounds = [];
    table.cue = null;
    table.rack++;
    startMatch(table.match, table.match.players as [string, string]);
    table.match.shotNumber = nextTurn;
    table.match.message = "Opening break.";
    table.result = createShotResult();
    table.lastCommand = null;
    table.turnAt = now;
    table.saved = false;
    table.rematchReady.clear();
    this.recorder?.startGame(table.id);
  }
  expireTurn(table: GameTable, now: number) {
    if (
      (table.match.phase === "aiming" ||
        table.match.phase === "ball-in-hand") &&
      now - table.turnAt >= 90_000
    ) {
      table.cue = null;
      table.match.turn = table.match.turn === 0 ? 1 : 0;
      table.match.shotNumber++;
      table.match.phase = "ball-in-hand";
      table.match.message = "Time ran out. Ball in hand.";
      table.turnAt = now;
    }
  }
  update(dt: number, now = Date.now()) {
    if (!Number.isFinite(dt) || dt < 0)
      throw new RangeError("dt must be finite and nonnegative");
    dt = Math.min(dt, 0.2);
    this.tick++;
    for (const guest of this.guests.values()) {
      if (!guest.peer && now - guest.disconnectedAt > 60_000) {
        this.leave(guest);
        removeAvatar(this.world, guest.eid);
        this.guests.delete(guest.state.id);
        this.tokens.delete(guest.token);
        continue;
      }
      this.expireInputs(guest, now);
      const input = dt > 0 ? guest.queue.shift() : undefined;
      if (input) {
        guest.input = input;
        if (input.x || input.z) delete guest.state.seat;
        if (!guest.state.table && !guest.state.seat && guest.state.connected) {
          const pos = stepAvatar(
            this.world,
            guest.eid,
            input.x,
            input.z,
            INPUT_DT,
          );
          guest.state.x = pos.x;
          guest.state.z = pos.z;
          if (input.x || input.z)
            guest.state.yaw = Math.atan2(input.x, input.z);
        }
        guest.state.seq = input.seq;
      }
    }

    for (const table of this.tables) {
      if (
        table.cue &&
        (now - table.cueAt > 1200 ||
          table.cue.turn !== table.match.shotNumber ||
          table.cue.player !== table.match.players[table.match.turn] ||
          (table.match.phase !== "aiming" &&
            table.match.phase !== "ball-in-hand"))
      )
        table.cue = null;
      const moving = table.physics.step(dt, table.result);
      const soundTime = this.tick * INPUT_DT * 1000;
      table.sounds = table.sounds.filter(
        (sound) => sound.time >= soundTime - 250,
      );
      for (const sound of table.physics.sounds) {
        table.sounds.push({
          ...sound,
          id: ++table.nextSoundId,
          time: soundTime,
          turn: table.soundTurn,
        });
      }
      if (table.sounds.length > 48)
        table.sounds.splice(0, table.sounds.length - 48);
      this.recorder?.sample(
        table.id,
        this.tick,
        dt,
        table.balls,
        table.physics.events,
      );
      if (table.match.phase === "rolling" && !moving) {
        resolveShot(table.match, table.balls, table.result);
        this.recorder?.resolved(table.id, table.match, table.result);
        table.turnAt = now;
        this.record(table);
      }
      this.expireTurn(table, now);
      this.updateBot(table, now);
    }
  }
  record(table: GameTable) {
    if (table.match.phase !== "finished" || !table.match.winner || table.saved)
      return;
    this.saveResult(
      table.id,
      table.match.winner,
      table.match.players.filter((p): p is string => !!p),
    );
    table.saved = true;
    this.recorder?.endGame(
      table.id,
      JSON.stringify({
        winnerSeat: table.match.players.indexOf(table.match.winner),
      }),
    );
  }
  snapshot(): Snapshot {
    const time = Math.max(
      this.snapshotTime + 0.001,
      this.tick * INPUT_DT * 1000,
    );
    this.snapshotTime = time;
    return {
      type: "state",
      tick: this.tick,
      room: this.getRoomSettings(),
      time,
      players: [...this.guests.values()]
        .map((g) => ({ ...g.state }))
        .concat({ ...this.bot }),
      tables: this.tables.map((t) => ({
        id: t.id,
        match: structuredClone(t.match),
        rematchReady: [...t.rematchReady],
        rack: t.rack,
        sounds: t.sounds
          .filter((sound) => sound.time >= this.tick * INPUT_DT * 1000 - 250)
          .map((sound) => ({ ...sound })),
        ...(t.cue
          ? {
              cue: {
                ...t.cue,
                placement: t.cue.placement && { ...t.cue.placement },
              },
            }
          : {}),
        balls: t.balls.map((b) => ({ ...b, q: [...b.q], w: [...b.w] })),
      })),
    };
  }
  dispose() {
    this.recorder?.close();
    for (const table of this.tables) table.physics.dispose();
  }
  broadcast(message: ServerMessage) {
    for (const guest of this.guests.values())
      if (guest.peer) this.send(guest.peer, message);
  }
}
