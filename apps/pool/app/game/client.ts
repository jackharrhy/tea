import { Vector3 } from "three";
import { listenerPose } from "./audio-listener";
import { FELT_Y } from "@tea/pool/table";
import { CUE_CONTACT_MS } from "./scene/cue-pose";
import { HallView } from "./scene/world";
import { LocalPrediction, RemoteMotion } from "./prediction/net-state";
import type { MotionEntity } from "./prediction/net-state";
import type { PoolPrediction } from "./prediction/pool-prediction";
import { ShotCommands } from "./prediction/shot-command";
import { Controls } from "./input/controls";
import { GameAudio } from "./audio";
import { GameUI } from "./ui";
import { Session } from "./session";
import {
  HALL_SPAWN,
  TABLES,
  tableSeatPosition,
} from "@tea/pool-simulation/geometry";
import { tableApproach } from "@tea/pool-simulation";
import type { Point } from "@tea/pool-simulation";
import { INPUT_DT, MAX_INPUT_BATCH } from "@tea/pool-protocol";
import type {
  MoveInput,
  ServerMessage,
  Snapshot,
  PoolTraceMessage,
  RoomSettings,
  TableState,
} from "@tea/pool-protocol";
import { installAccount } from "./account";
import { ClientTelemetry } from "./client-telemetry";
import { PoolTraceCapture, encodePoolTrace } from "./pool-trace";
export class GameClient {
  private poolTrace = new PoolTraceCapture();
  private traceUploading = false;
  private lastTraceSent = -Infinity;
  private pendingTrace: {
    message: PoolTraceMessage;
    expiresAt: number;
  } | null = null;
  private telemetry = new ClientTelemetry(performance.now());
  private readonly audio = new GameAudio();
  private readonly audioForward = new Vector3(0, 0, -1);
  private readonly listeningPosition = {
    x: HALL_SPAWN.x,
    y: 1.35,
    z: HALL_SPAWN.z,
  };
  private readonly ui: GameUI;
  private readonly session: Session;
  private readonly shots: ShotCommands;
  private room: RoomSettings | null = null;
  private view!: HallView;
  private controls!: Controls;
  private prediction: LocalPrediction | null = null;
  private poolPrediction: PoolPrediction | null = null;
  private remote = new RemoteMotion(125);
  private unsent: MoveInput[] = [];
  private localYaw = 0;
  private id = "";
  private entered = false;
  private seq = 0;
  private state: Snapshot | null = null;
  private stateReceivedAt = 0;
  private focusTable: string | null = null;
  private lastOwnTable: string | null = null;
  private inputRemainder = 0;
  private previous = 0;
  private renderedYaw = 0;
  private lastCueSentAt = -Infinity;
  private lastCuePose = "";
  private disposed = false;
  private viewReady = false;
  private viewDisposed = false;
  private readonly abort = new AbortController();
  private readonly intervals: ReturnType<typeof setInterval>[] = [];
  private accountCleanup?: () => void;
  constructor(root: HTMLElement, canvas: HTMLCanvasElement) {
    this.ui = new GameUI(this.audio, root, canvas);
    this.session = new Session(() => this.ui.identity(), {
      message: (message) => this.receive(message),
      closed: () => this.disconnected(),
      status: (text) => this.ui.status(text),
      notice: (text) => this.ui.toast(text),
    });
    this.shots = new ShotCommands(
      (command) => {
        const sent = this.session.send(command);
        if (sent) this.poolTrace.sent(command.id, performance.now());
        return sent;
      },
      (text) => this.ui.toast(text),
    );
  }
  async start() {
    if (this.disposed) return;
    try {
      this.view = new HallView(this.ui.canvas);
      await this.view.init();
      this.viewReady = true;
      if (this.disposed) {
        this.disposeView();
        return;
      }
      this.ui.ready();
      this.audio.onError = (message) => this.ui.toast(message);
      void installAccount(this.abort.signal, this.ui.root).then((cleanup) => {
        if (this.disposed) cleanup?.();
        else this.accountCleanup = cleanup;
      });
    } catch (error) {
      this.disposeView();
      if (this.disposed) return;
      this.ui.failed();
      throw error;
    }
    void import("./prediction/pool-prediction")
      .then(({ PoolPrediction }) => {
        if (this.disposed) return;
        this.poolPrediction = new PoolPrediction(
          (table, turn, error) =>
            this.telemetry.correction("pool", table, turn, error),
          (table, rack, turn, sound) =>
            this.audio.predicted(table, rack, turn, sound),
          (event) => this.poolTrace.correction(event),
        );
        if (this.room) this.poolPrediction.setGravity(this.room.gravity);
      })
      .catch((error) => {
        if (this.disposed) return;
        console.error("Local pool physics failed to load", error);
        this.ui.toast("Local physics could not load. Reload to try again.");
      });
    this.controls = new Controls(this.ui.canvas, this.view, this.ui, {
      read: () => ({
        id: this.id,
        own: this.me(),
        table: this.currentTable(),
        entered: this.entered,
        connected: this.session.connected,
        focusTable: this.focusTable,
        shotBlocked: this.shotBlocked(),
      }),
      position: () => this.position(),
      focus: (table) => {
        this.focusTable = table;
      },
      changed: () => this.updateUI(),
      joinNearby: () => this.join(this.ui.nearby),
      arrive: (table) => this.arriveAtTable(table),
      approach: (table) => this.approach(table),
      shoot: (shot) => this.shoot(shot),
      send: (message) => {
        if (message.type === "sit") this.flushInputs();
        return this.session.send(message);
      },
    });
    this.controls.bind();
    this.ui.bind({
      enter: () => this.session.connect(),
      action: (action) => this.action(action),
      send: (message) => this.session.send(message),
      cancelShot: () => this.controls.cancelShot(),
      clearKeys: () => this.controls.keys.clear(),
    });
    this.intervals.push(setInterval(() => this.flushInputs(), 50));
    this.intervals.push(
      setInterval(() => {
        for (const report of this.telemetry.flush(performance.now()))
          if (this.session.connected) this.session.send(report);
      }, 1000),
    );
    this.intervals.push(
      setInterval(() => {
        this.shots.tick(performance.now());
        this.flushPoolTrace(performance.now());
      }, 100),
    );
    this.intervals.push(
      setInterval(() => {
        if (this.session.connected)
          this.session.send({ type: "ping", time: Date.now() });
      }, 10_000),
    );
    window.addEventListener(
      "resize",
      () => {
        this.controls.cancelShot();
        this.view.resize();
        this.updateUI();
      },
      { signal: this.abort.signal },
    );
    this.previous = performance.now();
    this.session.connect(true);
    await this.view.renderer.setAnimationLoop((now) => this.frame(now));
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    for (const interval of this.intervals) clearInterval(interval);
    this.intervals.length = 0;
    this.accountCleanup?.();
    this.accountCleanup = undefined;
    this.session.dispose();
    this.controls?.dispose();
    this.ui.dispose();
    this.shots.cancel();
    this.poolPrediction?.cancel();
    this.audio.onError = null;
    this.audio.dispose();
    if (this.viewReady) this.disposeView();
  }
  private disposeView() {
    if (!this.view || this.viewDisposed) return;
    this.viewDisposed = true;
    void this.view.dispose().catch((error) => {
      console.error("Pool renderer cleanup failed", error);
    });
  }
  private shotBlocked() {
    return !!this.shots.pending || !!this.poolPrediction?.active;
  }
  private position(): Point {
    return this.prediction?.position() ?? { ...HALL_SPAWN };
  }

  private me() {
    return this.state?.players.find((p) => p.id === this.id);
  }
  private currentTable() {
    return this.state?.tables.find((t) => t.id === this.focusTable);
  }
  private myTurn(table: TableState) {
    return (
      this.session.connected &&
      table.match.players[table.match.turn] === this.id
    );
  }

  private applySnapshot(next: Snapshot) {
    const receivedAt = performance.now();
    if (this.state && next.time <= this.state.time) {
      this.poolTrace.packet(next, receivedAt, false, this.remote.clockOffsetMs);
      return;
    }
    this.state = next;
    if (next.room) this.applyRoomSettings(next.room);
    const own = this.me();
    const ownTable = next.tables.find((table) => table.id === own?.table);
    this.telemetry.context(own?.table ?? null, ownTable?.rack ?? null);
    this.controls.validateCharge();
    if (own) {
      if (own.table !== this.lastOwnTable) {
        this.shots.cancel();
        this.poolPrediction?.cancel();
        this.view.cancelCueStrike();
        this.focusTable = own.table;
        this.controls.angle = Math.PI / 2;
        this.lastOwnTable = own.table;
        this.controls.clearDestination();
      }
      const before = this.position();
      if (!this.prediction)
        this.prediction = new LocalPrediction(own, (error) =>
          this.telemetry.correction("movement", null, null, error),
        );
      else this.prediction.reconcile(own);
      this.unsent = this.unsent.filter(
        (input) => input.seq > Math.max(own.seq, own.retiredSeq),
      );
      if (own.table) this.unsent = [];
      const corrected = this.position();
      this.controls.reconcile(before, corrected, !!own.table);
      this.seq = Math.max(this.seq, own.seq, own.retiredSeq);
    }
    const entities: MotionEntity[] = next.players.map((player) => ({
      id: `player:${player.id}`,
      x: player.x,
      y: 0,
      z: player.z,
      yaw: player.yaw,
      epoch: `player:${player.revision}`,
    }));
    for (const table of next.tables)
      for (const ball of table.balls)
        entities.push({
          id: `ball:${table.id}:${ball.id}`,
          x: ball.x,
          y: ball.y,
          z: ball.z,
          q: { x: ball.q[0], y: ball.q[1], z: ball.q[2], w: ball.q[3] },
          epoch: `${table.rack}:${ball.revision}`,
        });
    this.telemetry.packet(receivedAt);
    this.stateReceivedAt = receivedAt;
    this.remote.ingest(next.time, entities, receivedAt);
    this.poolTrace.packet(next, receivedAt, true, this.remote.clockOffsetMs);
    this.poolPrediction?.ingest(next, receivedAt);
    this.audio.setPrediction(this.poolPrediction?.soundContext ?? null);
    this.audio.observe(next, this.focusTable);
    this.shots.ingest(next);
    this.view.syncTables(next.tables, next.players, this.id);
    this.view.syncPlayers(next.players, this.id, next.tables);
    this.updateUI();
  }

  private applyRoomSettings(settings: RoomSettings) {
    if (
      this.room &&
      this.room.lightIntensity === settings.lightIntensity &&
      this.room.cutaway === settings.cutaway &&
      this.room.gravity.every(
        (value, index) => value === settings.gravity[index],
      )
    )
      return;
    this.room = settings;
    this.view.applyRoomSettings(settings);
    this.poolPrediction?.setGravity(settings.gravity);
  }

  private receive(message: ServerMessage) {
    if (message.type === "welcome") {
      this.telemetry = new ClientTelemetry(performance.now());
      this.poolTrace.reset();
      this.shots.cancel();
      this.poolPrediction?.cancel();
      this.view.cancelCueStrike();
      this.id = message.id;
      this.entered = true;
      this.prediction = null;
      this.remote = new RemoteMotion(125);
      this.unsent = [];
      this.seq = 0;
      this.state = null;
      this.focusTable = null;
      this.lastOwnTable = null;
      this.controls.keys.clear();
      this.ui.welcome();
      this.updateUI();
    } else if (message.type === "state") this.applySnapshot(message);
    else if (message.type === "room-settings")
      this.applyRoomSettings(message.settings);
    else if (message.type === "shot-ack") {
      const receivedAt = performance.now();
      this.poolTrace.acknowledge(message, receivedAt);
      this.poolPrediction?.acknowledge(message, receivedAt);
      if (this.shots.acknowledge(message)) {
        this.view.cancelCueStrike();
        this.ui.toast(message.text ?? "That shot was not accepted. Try again.");
      }
      this.updateUI();
    } else if (message.type === "approach") {
      this.join(message.table);
    } else if (message.type === "error") {
      this.ui.toast(message.text);
      this.updateUI();
    } else if (message.type === "chat") {
      this.ui.chat(message);
    }
  }
  private flushPoolTrace(now: number) {
    if (this.pendingTrace && now > this.pendingTrace.expiresAt)
      this.pendingTrace = null;
    if (
      this.pendingTrace &&
      this.session.connected &&
      now - this.lastTraceSent >= 31000 &&
      this.session.send(this.pendingTrace.message)
    ) {
      this.lastTraceSent = now;
      this.pendingTrace = null;
    }
    if (this.pendingTrace || this.traceUploading) return;
    const trace = this.poolTrace.take(now);
    if (!trace) return;
    this.traceUploading = true;
    void encodePoolTrace(trace)
      .then((message) => {
        if (message)
          this.pendingTrace = { message, expiresAt: performance.now() + 60000 };
        else console.warn("Pool trace exceeded the capture budget", trace.id);
      })
      .catch((error) => console.warn("Pool trace capture failed", error))
      .finally(() => {
        this.traceUploading = false;
      });
  }
  private disconnected() {
    this.flushPoolTrace(performance.now());
    this.audio.reset();
    this.telemetry = new ClientTelemetry(performance.now());
    this.poolTrace.reset();
    this.shots.cancel();
    this.poolPrediction?.cancel();
    this.view.cancelCueStrike();
    this.unsent = [];
    this.controls.disconnected();
    this.updateUI();
  }
  private updateUI() {
    this.ui.render(
      this.state,
      this.id,
      this.entered,
      this.session.connected,
      this.focusTable,
      this.position(),
    );
  }
  private approach(tableId: string): Point {
    const table = this.state?.tables.find((t) => t.id === tableId);
    const seat = table?.match.players.indexOf(null) ?? -1;
    return seat >= 0
      ? tableSeatPosition(tableId, seat as 0 | 1)
      : tableApproach(tableId, this.position());
  }

  private arriveAtTable(tableId: string) {
    const table = this.state?.tables.find((t) => t.id === tableId);
    if (!table) return;
    if (table.match.players.includes(null) && !this.me()?.table)
      this.join(tableId);
    else {
      this.focusTable = tableId;
      this.controls.clearDestination();
      this.updateUI();
    }
  }

  private join(tableId: string | null) {
    const table = this.state?.tables.find((t) => t.id === tableId);
    const own = this.me();
    if (!table || !own || own.table) return;
    this.controls.stopWalkingPointer();
    this.controls.keys.clear();
    const seat = table.match.players.indexOf(null);
    if (seat < 0) {
      this.focusTable = table.id;
      this.controls.clearDestination();
    } else {
      const target = tableSeatPosition(table.id, seat as 0 | 1);
      const here = this.position();
      if (
        Math.hypot(own.x - target.x, own.z - target.z) < 0.04 &&
        Math.hypot(here.x - target.x, here.z - target.z) < 0.04
      ) {
        this.flushInputs();
        this.session.send({ type: "join", table: table.id });
        this.controls.clearDestination();
      } else {
        this.focusTable = null;
        this.controls.walkTo(target, table.id, null);
      }
    }
    this.updateUI();
  }

  private action(
    action: "join" | "take-seat" | "watch" | "back" | "leave" | "rematch",
  ) {
    switch (action) {
      case "join":
        this.join(this.ui.nearby);
        break;
      case "take-seat":
        this.join(this.focusTable);
        break;
      case "watch":
        this.focusTable = this.ui.nearby;
        this.controls.clearDestination();
        this.controls.keys.clear();
        this.updateUI();
        break;
      case "back":
        this.focusTable = null;
        this.updateUI();
        this.ui.canvas.focus();
        break;
      case "leave":
        this.session.send({ type: "leave" });
        this.focusTable = null;
        this.updateUI();
        this.ui.canvas.focus();
        break;
      case "rematch": {
        const table = this.currentTable();
        if (table)
          this.session.send({
            type: "rematch",
            table: table.id,
            turn: table.match.shotNumber,
          });
      }
    }
  }
  private shoot(shot: {
    table: string;
    turn: number;
    angle: number;
    power: number;
  }) {
    const table = this.currentTable();
    if (
      this.controls.cameraDrag ||
      !table ||
      !this.myTurn(table) ||
      table.id !== shot.table ||
      table.match.shotNumber !== shot.turn ||
      table.match.phase !== "aiming" ||
      this.shotBlocked()
    )
      return;
    const command = this.shots.start(shot);
    if (command) {
      const now = this.shots.pending!.at;
      if (this.poolPrediction?.start(table, command, now + CUE_CONTACT_MS)) {
        this.poolTrace.begin(
          {
            command: {
              id: command.id,
              table: command.table,
              turn: command.turn,
              angle: command.angle,
              power: command.power,
            },
            rack: table.rack,
            initial: table.balls,
            gravity: this.room?.gravity ?? [0, -9.81, 0],
            initialSnapshot: {
              tick: this.state!.tick,
              time: this.state!.time,
              receivedAt: this.stateReceivedAt,
            },
            sentAt: now,
            cueContactAt: now + CUE_CONTACT_MS,
            clientBuild:
              `${import.meta.env.VITE_APP_REVISION ?? "development"}:${new URL(import.meta.url).pathname}${new URL(import.meta.url).search}`.slice(
                0,
                128,
              ),
            physicsBuild: import.meta.env.VITE_POOL_BUILD ?? "development",
            userAgent: navigator.userAgent.slice(0, 256),
          },
          now,
        );
      }
      this.view.strikeCue(table.id, shot.angle, now);
      this.updateUI();
    }
  }

  private inputTick() {
    if (
      !this.session.connected ||
      !this.entered ||
      !this.me() ||
      !this.prediction ||
      this.me()!.table
    )
      return;
    const { x, z } = this.controls.direction();
    const input = { seq: this.seq + 1, x, z };
    if (this.prediction.predict(input)) {
      this.seq = input.seq;
      this.unsent.push(input);
      if (x || z) this.localYaw = Math.atan2(x, z);
    }
    this.ui.updateNearby(
      this.state,
      this.id,
      this.entered,
      this.focusTable,
      this.position(),
    );
  }

  private flushInputs() {
    if (!this.session.connected) return;
    while (this.unsent.length) {
      const inputs = this.unsent.slice(0, MAX_INPUT_BATCH);
      if (!this.session.send({ type: "move", inputs })) break;
      this.unsent.splice(0, inputs.length);
    }
  }

  private publishCue(now: number, table: TableState | undefined) {
    if (
      !table ||
      this.me()?.table !== table.id ||
      !this.myTurn(table) ||
      this.shotBlocked() ||
      (table.match.phase !== "aiming" && table.match.phase !== "ball-in-hand")
    )
      return;
    const placement =
      table.match.phase === "ball-in-hand" ? this.controls.placement : null;
    const message = {
      type: "cue" as const,
      table: table.id,
      turn: table.match.shotNumber,
      angle: this.controls.angle,
      power: this.controls.power,
      placement,
    };
    const pose = JSON.stringify(message);
    if (
      now - this.lastCueSentAt < 75 ||
      (pose === this.lastCuePose && now - this.lastCueSentAt < 400)
    )
      return;
    if (this.session.send(message)) {
      this.lastCueSentAt = now;
      this.lastCuePose = pose;
    }
  }

  private frame(now: number) {
    const rawFrameMs = Math.max(0, now - this.previous);
    const dt = Math.min(rawFrameMs / 1000, 0.2);
    this.previous = now;
    this.inputRemainder += dt;
    while (this.inputRemainder >= INPUT_DT) {
      this.inputTick();
      this.inputRemainder -= INPUT_DT;
    }
    if (this.unsent.length >= MAX_INPUT_BATCH) this.flushInputs();
    const table = this.currentTable();
    const fraction = this.inputRemainder / INPUT_DT;
    const local = this.prediction?.sample(dt, fraction) ?? null;
    this.renderedYaw +=
      Math.atan2(
        Math.sin(this.localYaw - this.renderedYaw),
        Math.cos(this.localYaw - this.renderedYaw),
      ) * -Math.expm1(-18 * dt);
    this.view.updateCamera(
      dt,
      local,
      this.focusTable,
      this.entered,
      !!this.controls.shotDrag || !!this.controls.keyCharge,
    );
    this.view.camera.getWorldDirection(this.audioForward);
    const listener = listenerPose(
      local ?? this.position(),
      TABLES.find((candidateTable) => candidateTable.id === this.focusTable) ??
        null,
      this.audioForward,
      FELT_Y,
    );
    const hearingBlend = -Math.expm1(-10 * dt);
    for (const axis of ["x", "y", "z"] as const)
      this.listeningPosition[axis] +=
        (listener.position[axis] - this.listeningPosition[axis]) * hearingBlend;
    this.audio.updateListener(this.listeningPosition, listener.forward);
    this.audio.setPrediction(this.poolPrediction?.soundContext ?? null);
    if (this.controls.movePointer)
      this.controls.walkAt(
        this.controls.movePointer.x,
        this.controls.movePointer.y,
      );
    const poses = this.remote.sample(now);
    const rendered = this.poolPrediction?.sample(now, dt, poses) ?? poses;
    if (this.poolPrediction)
      this.poolTrace.frame(
        now,
        rawFrameMs,
        this.poolPrediction.traceState,
        rendered,
      );
    this.view.applyMotion(rendered, this.id, local, this.renderedYaw);
    if (this.controls.keyCharge)
      this.controls.power = Math.min(
        1,
        Math.max(0, (now - this.controls.keyCharge.at) / 1200),
      );
    this.view.setAim(
      this.focusTable,
      this.controls.angle,
      this.controls.power,
      !!table &&
        this.myTurn(table) &&
        table.match.phase === "aiming" &&
        !this.shotBlocked(),
      dt,
      now,
    );
    this.publishCue(now, table);
    this.view.setTablePresence(
      this.state?.tables ?? [],
      this.id,
      table &&
        this.myTurn(table) &&
        table.match.phase === "ball-in-hand" &&
        this.controls.placement
        ? { table: table.id, point: this.controls.placement }
        : null,
      dt,
      (this.state?.time ?? 0) + now - this.stateReceivedAt,
    );
    this.view.render(dt);
  }
}
