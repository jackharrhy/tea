import {
  SnapshotInterpolation,
  Vault,
} from "@geckos.io/snapshot-interpolation";
import type { Types } from "@geckos.io/snapshot-interpolation";
import { lerp, vec2 } from "math";
import {
  addAvatar,
  createMovementWorld,
  stepAvatar,
} from "@harrhy/pool-simulation";

import { INPUT_DT } from "@harrhy/pool-protocol";
import type { MoveInput } from "@harrhy/pool-protocol";
export { INPUT_DT };
export type { MoveInput };
export type AuthoritativePosition = {
  x: number;
  z: number;
  seq: number;
  retiredSeq?: number;
  table?: string | null;
  revision?: number;
};
type Point = { x: number; z: number };

/** Inputs use seconds; networking owns batching and sends only accepted inputs. */
export class LocalPrediction {
  private world = createMovementWorld();
  private avatar: number;
  private pending: MoveInput[] = [];
  private error = vec2.create();
  private acknowledged: number;
  private lastSequence: number;
  private table: string | null;
  private revision: number;
  private previous: Point;

  constructor(
    initial: AuthoritativePosition,
    private readonly onCorrection?: (error: number) => void,
  ) {
    this.avatar = addAvatar(this.world, initial.x, initial.z);
    this.previous = { x: initial.x, z: initial.z };
    this.acknowledged = this.lastSequence = Math.max(
      initial.seq,
      initial.retiredSeq ?? 0,
    );
    this.table = initial.table ?? null;
    this.revision = initial.revision ?? 0;
  }

  get pendingCount() {
    return this.pending.length;
  }

  /** False means backpressure, a seated avatar, or an already-used sequence. */
  predict(input: MoveInput): boolean {
    if (this.table || input.seq <= this.lastSequence) return false;
    if (this.pending.length >= 120) {
      this.previous = this.position();
      return false;
    }
    this.lastSequence = input.seq;
    this.pending.push({ ...input });
    this.previous = this.position();
    stepAvatar(this.world, this.avatar, input.x, input.z, INPUT_DT);
    return true;
  }

  reconcile(state: AuthoritativePosition): void {
    const acknowledged = Math.max(state.seq, state.retiredSeq ?? 0);
    if (
      acknowledged < this.acknowledged ||
      (state.revision ?? 0) < this.revision
    )
      return;
    const before = this.position();
    const table = state.table ?? null;
    const teleport =
      (state.revision ?? 0) !== this.revision || table !== this.table;
    this.acknowledged = acknowledged;
    this.lastSequence = Math.max(this.lastSequence, acknowledged);
    this.table = table;
    this.revision = state.revision ?? 0;
    this.pending = teleport
      ? []
      : this.pending.filter((input) => input.seq > acknowledged);
    const position = this.world.components.Position;
    position.x[this.avatar] = state.x;
    position.z[this.avatar] = state.z;
    for (const input of this.pending)
      stepAvatar(this.world, this.avatar, input.x, input.z, INPUT_DT);
    const after = this.position();
    if (!teleport)
      this.onCorrection?.(Math.hypot(after.x - before.x, after.z - before.z));
    if (teleport || Math.hypot(after.x - before.x, after.z - before.z) > 3) {
      vec2.zero(this.error);
      this.previous = after;
    } else {
      const dx = after.x - before.x,
        dz = after.z - before.z;
      this.previous = { x: this.previous.x + dx, z: this.previous.z + dz };
      vec2.add(this.error, this.error, [-dx, -dz]);
    }
  }

  position(): Point {
    const p = this.world.components.Position;
    return { x: p.x[this.avatar], z: p.z[this.avatar] };
  }

  /** Render between predicted ticks; fraction is the fixed-step remainder, dt is seconds. */
  sample(dt: number, fraction = 1): Point {
    vec2.lerp(
      this.error,
      this.error,
      [0, 0],
      -Math.expm1(-14 * Math.max(0, dt)),
    );
    const p = this.position();
    const alpha = Math.max(0, Math.min(1, fraction));
    return {
      x: lerp(this.previous.x, p.x, alpha) + this.error[0],
      z: lerp(this.previous.z, p.z, alpha) + this.error[1],
    };
  }
}

export type MotionEntity = {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw?: number;
  q?: { x: number; y: number; z: number; w: number };
  epoch: string;
};
type Track = { vault: Vault; first: Types.Snapshot; latest: Types.Snapshot };
const poseOf = (snapshot: Types.Snapshot) =>
  (snapshot.state as MotionEntity[])[0];
const copyPose = (pose: MotionEntity): MotionEntity => ({
  ...pose,
  ...(pose.q ? { q: { ...pose.q } } : {}),
});

/**
 * ingest accepts complete entity sets, server timestamps in ms, and performance.now()
 * receipt times. sample takes the same local clock. Epochs change only for actual
 * discontinuities (rack/placement), never for rolling -> aiming phase changes.
 */
export class RemoteMotion {
  private interpolation = new SnapshotInterpolation(null, {
    autoCorrectTimeOffset: false,
  });
  private tracks = new Map<string, Track>();
  private offset = Infinity;
  private offsets: { at: number; value: number }[] = [];
  private latestTime = -Infinity;
  private playback = -Infinity;
  private sampledAt: number | undefined;

  get clockOffsetMs() {
    return Number.isFinite(this.offset) ? this.offset : null;
  }

  constructor(readonly delay = 125) {
    if (delay < 100 || delay > 150 || !Number.isFinite(delay))
      throw new RangeError("Playback delay must be 100–150 milliseconds");
  }

  ingest(time: number, entities: MotionEntity[], now: number): void {
    // Complete snapshots supersede late/duplicate packets, including obsolete epochs.
    if (time <= this.latestTime) return;
    this.latestTime = time;
    this.offsets.push({ at: now, value: now - time });
    this.offsets = this.offsets.filter((sample) => sample.at >= now - 2000);
    this.offset = Math.min(...this.offsets.map((sample) => sample.value));
    const present = new Set<string>();
    for (const entity of entities) {
      present.add(entity.id);
      const snapshot: Types.Snapshot = {
        id: `${entity.id}:${time}`,
        time,
        state: [copyPose(entity)],
      };
      let track = this.tracks.get(entity.id);
      const previous = track && poseOf(track.latest);
      if (
        !track ||
        (previous &&
          (previous.epoch !== entity.epoch ||
            Math.hypot(
              previous.x - entity.x,
              previous.y - entity.y,
              previous.z - entity.z,
            ) > 3))
      ) {
        track = { vault: new Vault(), first: snapshot, latest: snapshot };
        track.vault.setMaxSize(120);
        this.tracks.set(entity.id, track);
      }
      if (track.vault.size === track.vault.getMaxSize())
        track.first = track.vault.get(track.first.time)!.newer;
      track.vault.add(snapshot);
      track.latest = snapshot;
    }
    for (const id of this.tracks.keys())
      if (!present.has(id)) this.tracks.delete(id);
  }

  sample(now: number): MotionEntity[] {
    if (!Number.isFinite(this.latestTime)) return [];
    const desired = Math.min(this.latestTime, now - this.offset - this.delay);
    // Slew toward better offset estimates without reversing or jumping on jitter.
    const elapsed =
      this.sampledAt === undefined
        ? Infinity
        : Math.max(0, now - this.sampledAt);
    this.playback =
      this.sampledAt === undefined
        ? desired
        : Math.max(
            this.playback,
            Math.min(desired, this.playback + elapsed * 1.1),
          );
    this.sampledAt = Math.max(this.sampledAt ?? now, now);
    return Array.from(this.tracks.values(), (track) => {
      const pair = track.vault.get(this.playback);
      if (!pair) return copyPose(poseOf(track.first));
      if (!pair.newer) return copyPose(poseOf(pair.older));
      const fraction =
        (this.playback - pair.older.time) / (pair.newer.time - pair.older.time);
      // Explicit fraction avoids the library's ambiguity for server times <= 1ms.
      const pose = (
        this.interpolation.interpolate(
          pair.older,
          pair.newer,
          fraction,
          "x y z q(quat)",
        ).state as MotionEntity[]
      )[0];
      const from = poseOf(pair.older).yaw;
      const to = poseOf(pair.newer).yaw;
      // v1.1.1's method parser only handles single-letter property names.
      if (from !== undefined && to !== undefined) {
        const delta = vec2.signedAngle(
          [Math.cos(from), Math.sin(from)],
          [Math.cos(to), Math.sin(to)],
        );
        pose.yaw = lerp(from, from + delta, fraction);
      }
      return pose;
    });
  }
}
