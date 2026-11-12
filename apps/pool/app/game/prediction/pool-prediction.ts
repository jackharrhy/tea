import { PoolPhysics } from "@harrhy/pool/engine";
import { createShotResult } from "@harrhy/pool";
import type { PhysicalBall, PoolSound } from "@harrhy/pool";
import { INPUT_DT } from "@harrhy/pool-protocol";
import type {
  PoolTraceCorrection,
  Snapshot,
  TableState,
} from "@harrhy/pool-protocol";
import type { MotionEntity } from "./net-state";

function toPoses(values: Iterable<MotionEntity>) {
  return [...values].map((p) => ({
    id: Number(p.id.split(":")[2]),
    x: p.x,
    y: p.y,
    z: p.z,
    epoch: p.epoch,
    ...(p.q
      ? {
          q: [p.q.x, p.q.y, p.q.z, p.q.w] as [number, number, number, number],
        }
      : {}),
  }));
}

type Command = {
  id: string;
  table: string;
  turn: number;
  angle: number;
  power: number;
};
type Ack = {
  id: string;
  table: string;
  turn: number;
  accepted: boolean;
  time: number;
};
const TICK = INPUT_DT * 1000;
const HISTORY = 120;
const MAX_STEPS = 60;
const BLEND_MS = 180;
const copyBalls = (balls: PhysicalBall[]): PhysicalBall[] =>
  balls.map((ball) => ({ ...ball, q: [...ball.q], w: [...ball.w] }));

type Quaternion = NonNullable<MotionEntity["q"]>;
const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
const ERROR_DECAY_MS = 90;
type PoseError = {
  x: number;
  y: number;
  z: number;
  epoch: string;
  q?: Quaternion;
};

function nlerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  const x = a.x * (1 - t) + b.x * t * sign,
    y = a.y * (1 - t) + b.y * t * sign;
  const z = a.z * (1 - t) + b.z * t * sign,
    w = a.w * (1 - t) + b.w * t * sign;
  const length = Math.hypot(x, y, z, w);
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

function multiply(a: Quaternion, b: Quaternion): Quaternion {
  return nlerp(
    IDENTITY,
    {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    },
    1,
  );
}

function blend(from: MotionEntity, to: MotionEntity, t: number): MotionEntity {
  if (t === 0) return { ...from };
  if (t === 1) return { ...to };
  return {
    ...to,
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
    q: from.q && to.q ? nlerp(from.q, to.q, t) : to.q,
  };
}

/** now is monotonic milliseconds; dt is seconds. Call cancel on disconnect/leave. */
export class PoolPrediction {
  private shot: {
    command: Command;
    rack: number;
    started: number;
    serverStart?: number;
    heard: number;
    ids: Set<number>;
  } | null = null;
  private engine: PoolPhysics | null = null;
  private gravity: [number, number, number] = [0, -9.81, 0];
  private result = createShotResult();
  private tick = 0;
  private struck = false;
  private heardTick = 0;
  private history: { tick: number; balls: PhysicalBall[] }[] = [];
  private latest = -Infinity;
  private pending: Snapshot | null = null;
  private corrected = -Infinity;
  private corrections = 0;
  private droppedSteps = 0;
  private errors = new Map<string, PoseError>();
  private rendered = new Map<string, MotionEntity>();
  private blendFrom = new Map<string, MotionEntity>();
  private blendAt = 0;
  private handoff = false;

  constructor(
    private readonly onCorrection?: (
      table: string,
      turn: number,
      error: number,
    ) => void,
    private readonly onSound?: (
      table: string,
      rack: number,
      turn: number,
      sound: PoolSound,
    ) => void,
    private readonly onTrace?: (event: PoolTraceCorrection) => void,
  ) {}

  get traceState() {
    return {
      tick: this.tick,
      balls: this.engine?.balls ?? [],
      droppedSteps: this.droppedSteps,
    };
  }

  setGravity(vector: [number, number, number]): void {
    if (!vector.every(Number.isFinite))
      throw new RangeError("Gravity must contain finite components");
    if (vector.every((value, index) => value === this.gravity[index])) return;
    this.gravity = [...vector];
    this.cancel();
  }

  get soundContext() {
    return this.shot && !this.handoff
      ? {
          tableId: this.shot.command.table,
          rack: this.shot.rack,
          turn: this.shot.command.turn,
        }
      : null;
  }

  get active(): boolean {
    return this.shot !== null;
  }

  /** Restores during the latest shot, retained after handoff/cancel until the next start. */
  get correctionCount(): number {
    return this.corrections;
  }

  start(table: TableState, command: Command, now: number): boolean {
    this.cancel();
    this.corrections = 0;
    this.droppedSteps = 0;
    if (
      table.id !== command.table ||
      table.match.shotNumber !== command.turn ||
      table.match.phase !== "aiming" ||
      !Number.isFinite(now) ||
      !Number.isFinite(command.angle) ||
      !Number.isFinite(command.power) ||
      command.power < 0.02 ||
      command.power > 1 ||
      !table.balls.some((b) => b.id === 0 && !b.pocketed && b.stage === "table")
    )
      return false;
    this.engine = new PoolPhysics(table.balls);
    this.engine.setGravity(this.gravity);
    this.shot = {
      command: { ...command },
      rack: table.rack,
      started: now,
      heard: now,
      ids: new Set(table.balls.filter((b) => !b.pocketed).map((b) => b.id)),
    };
    this.record();
    return true;
  }

  acknowledge(ack: Ack, now: number): void {
    const shot = this.shot;
    if (
      !shot ||
      ack.id !== shot.command.id ||
      ack.table !== shot.command.table ||
      ack.turn !== shot.command.turn
    )
      return;
    if (this.handoff) return;
    if (!ack.accepted) {
      this.finish(now);
      return;
    }
    if (shot.serverStart !== undefined || !Number.isFinite(ack.time)) return;
    shot.serverStart = ack.time;
    shot.heard = now;
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      this.reconcile(pending, now);
    }
  }

  ingest(snapshot: Snapshot, now: number): void {
    const shot = this.shot;
    if (!shot || snapshot.time <= this.latest) return;
    this.latest = snapshot.time;
    const table = snapshot.tables.find((t) => t.id === shot.command.table);
    if (!table || table.rack !== shot.rack) {
      this.cancel();
      return;
    }
    if (table.match.shotNumber < shot.command.turn) return;
    if (table.match.shotNumber > shot.command.turn) {
      if (!this.handoff) this.finish(now);
      return;
    }
    if (this.handoff || table.match.phase !== "rolling") return;
    shot.heard = now;
    if (shot.serverStart === undefined) {
      this.pending = snapshot;
      return;
    }
    this.reconcile(snapshot, now);
  }

  sample(
    now: number,
    _dt: number,
    authoritative: MotionEntity[],
  ): MotionEntity[] {
    const shot = this.shot;
    if (!shot) return authoritative;
    if (
      !this.handoff &&
      (now - shot.started > 30000 || now - shot.heard > 3000)
    ) {
      this.cancel();
      return authoritative;
    }
    if (!this.handoff && !this.advance(now)) return authoritative;
    const overlay = this.modelPoses(now);
    for (const [id, pose] of overlay)
      overlay.set(id, this.applyError(pose, now));
    const fraction = Math.max(0, Math.min(1, (now - this.blendAt) / BLEND_MS));
    const merged = authoritative.map((pose) => {
      const target = overlay.get(pose.id) ?? pose;
      overlay.delete(pose.id);
      const from = this.blendFrom.get(pose.id);
      return from && from.epoch === target.epoch
        ? blend(from, target, fraction)
        : target;
    });
    for (const pose of overlay.values()) {
      const from = this.blendFrom.get(pose.id);
      merged.push(from ? blend(from, pose, fraction) : pose);
    }
    this.rendered = new Map(
      merged
        .filter(
          (p) =>
            shot.ids.has(Number(p.id.split(":")[2])) &&
            p.id.startsWith(`ball:${shot.command.table}:`),
        )
        .map((p) => [p.id, p]),
    );
    if (fraction === 1) {
      this.blendFrom.clear();
      if (this.handoff) this.cancel();
    }
    return merged;
  }

  cancel(): void {
    this.engine?.dispose();
    this.engine = null;
    this.shot = null;
    this.history = [];
    this.pending = null;
    this.rendered.clear();
    this.errors.clear();
    this.blendFrom.clear();
    this.handoff = false;
    this.tick = 0;
    this.struck = false;
    this.heardTick = 0;
    this.latest = this.corrected = -Infinity;
    this.result = createShotResult();
  }

  private modelPoses(now: number): Map<string, MotionEntity> {
    const overlay = new Map<string, MotionEntity>();
    // Render one tick behind simulation, using its accumulator remainder. History
    // stays at exact server-aligned ticks for reconciliation, including quaternions.
    const current = this.history.at(-1);
    const previous = this.history.at(-2) ?? current;
    const alpha = Math.max(
      0,
      Math.min(1, (now - this.shot!.started) / TICK - this.tick),
    );
    if (current)
      for (const ball of current.balls) {
        if (!this.shot!.ids.has(ball.id)) continue;
        const pose = this.pose(ball);
        const before = previous?.balls.find((b) => b.id === ball.id);
        overlay.set(
          pose.id,
          before && before.revision === ball.revision
            ? blend(this.pose(before), pose, alpha)
            : pose,
        );
      }
    return overlay;
  }

  private applyError(pose: MotionEntity, now: number): MotionEntity {
    const error = this.errors.get(pose.id);
    if (!error || error.epoch !== pose.epoch) return pose;
    const decay = Math.exp(-Math.max(0, now - this.corrected) / ERROR_DECAY_MS);
    return {
      ...pose,
      x: pose.x + error.x * decay,
      y: pose.y + error.y * decay,
      z: pose.z + error.z * decay,
      q:
        pose.q && error.q
          ? multiply(nlerp(IDENTITY, error.q, decay), pose.q)
          : pose.q,
    };
  }

  private pose(ball: PhysicalBall): MotionEntity {
    const shot = this.shot!;
    return {
      id: `ball:${shot.command.table}:${ball.id}`,
      x: ball.x,
      y: ball.y,
      z: ball.z,
      q: { x: ball.q[0], y: ball.q[1], z: ball.q[2], w: ball.q[3] },
      epoch: `${shot.rack}:${ball.revision}`,
    };
  }

  private record(): void {
    this.history.push({
      tick: this.tick,
      balls: copyBalls(this.engine!.balls),
    });
    if (this.history.length > HISTORY) this.history.shift();
  }

  private advance(now: number): boolean {
    if (now < this.shot!.started) return true;
    if (!this.struck) {
      const { angle, power } = this.shot!.command;
      this.engine!.strike(angle, power);
      this.struck = true;
      this.history = [];
      this.record();
    }
    const target = Math.floor((now - this.shot!.started) / TICK + 1e-7);
    if (target - this.tick > MAX_STEPS) {
      this.droppedSteps += target - this.tick;
      this.cancel();
      return false;
    }
    while (this.tick < target) {
      this.engine!.step(INPUT_DT, this.result);
      this.tick++;
      if (this.tick > this.heardTick) {
        const shot = this.shot!;
        for (const sound of this.engine!.sounds)
          this.onSound?.(
            shot.command.table,
            shot.rack,
            shot.command.turn,
            sound,
          );
        this.heardTick = this.tick;
      }
      this.record();
    }
    return true;
  }

  private reconcile(snapshot: Snapshot, now: number): void {
    const shot = this.shot!;
    const elapsed = snapshot.time - shot.serverStart!;
    if (elapsed < 0 || this.handoff || !this.advance(now)) return;
    const tick = Math.round(elapsed / TICK);
    const frame = this.history.find((sampleFrame) => sampleFrame.tick === tick);
    // Too old or ahead of our clock: wait for a usable observation, never replay from zero.
    if (!frame || this.tick - tick > MAX_STEPS || now - this.corrected < 100)
      return;
    const balls = snapshot.tables.find(
      (t) => t.id === shot.command.table,
    )!.balls;
    if ([...shot.ids].some((id) => !balls.some((b) => b.id === id))) {
      this.cancel();
      return;
    }
    // Sphere orientation is cosmetic; spin affects subsequent friction and collisions.
    const mismatch = balls
      .filter((b) => shot.ids.has(b.id))
      .some((b) => {
        const p = frame.balls.find(
          (candidatePoint) => candidatePoint.id === b.id,
        );
        return (
          !p ||
          Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) > 0.025 ||
          Math.hypot(p.vx - b.vx, p.vy - b.vy, p.vz - b.vz) > 0.2 ||
          p.pocketed !== b.pocketed ||
          p.revision !== b.revision ||
          p.stage !== b.stage ||
          Math.hypot(p.w[0] - b.w[0], p.w[1] - b.w[1], p.w[2] - b.w[2]) > 1
        );
      });
    if (!mismatch) return;
    // Measure only aligned history at an actual restore. Revision/stage changes
    // are intentional discontinuities, not prediction position errors.
    let correctionError = 0;
    for (const b of balls) {
      const p = frame.balls.find(
        (candidatePoint) => candidatePoint.id === b.id,
      );
      if (
        shot.ids.has(b.id) &&
        p &&
        p.revision === b.revision &&
        p.stage === b.stage &&
        p.pocketed === b.pocketed
      )
        correctionError = Math.max(
          correctionError,
          Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z),
        );
    }
    const before = this.modelPoses(now);
    for (const [id, pose] of before) before.set(id, this.applyError(pose, now));
    this.corrections++;
    this.onCorrection?.(shot.command.table, shot.command.turn, correctionError);
    this.engine!.restore(
      balls.filter((b) => frame.balls.some((p) => p.id === b.id)),
    );
    this.tick = tick;
    this.history = [];
    this.record();
    if (!this.advance(now)) return;
    this.errors.clear();
    for (const [id, after] of this.modelPoses(now)) {
      const prior = before.get(id);
      if (!prior || prior.epoch !== after.epoch) continue;
      this.errors.set(id, {
        x: prior.x - after.x,
        y: prior.y - after.y,
        z: prior.z - after.z,
        epoch: after.epoch,
        q:
          prior.q && after.q
            ? multiply(prior.q, {
                x: -after.q.x,
                y: -after.q.y,
                z: -after.q.z,
                w: after.q.w,
              })
            : undefined,
      });
    }
    this.corrected = now;
    if (this.onTrace) {
      this.onTrace({
        at: now,
        error: correctionError,
        serverTick: snapshot.tick,
        serverTime: snapshot.time,
        alignedTick: tick,
        replayedTick: this.tick,
        predicted: frame.balls,
        authoritative: balls,
        replayed: this.engine!.balls,
        renderedBefore: toPoses(this.rendered.values()),
        renderedAfter: toPoses(
          [...this.modelPoses(now).values()].map((p) =>
            this.applyError(p, now),
          ),
        ),
      });
    }
  }

  private finish(now: number): void {
    this.errors.clear();
    this.engine?.dispose();
    this.engine = null;
    this.history = [];
    this.pending = null;
    this.handoff = true;
    this.blendFrom = new Map(this.rendered);
    this.blendAt = now;
  }
}
