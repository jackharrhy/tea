import type { PhysicalBall, PoolSound } from "@harrhy/pool";
import { FELT_Y, MESH_REST_OFFSET, FELT_LIP_DROP } from "@harrhy/pool/table";

import { isReturnFloorLanding } from "./audio-surfaces";

export type PredictionContext = { tableId: string; rack: number; turn: number };
export type HeardSound = PredictionContext & {
  sound: PoolSound;
  heardAt: number;
  source: "predicted" | "server";
};
export type SoundEvent = PoolSound & { id: number; time: number; turn: number };

export const MAX_VOICES = 32;
export const MAX_IMPACT_VOICES = 24;
export const MAX_ROLLING_VOICES = 8;
const EVENT_MAX_AGE = 250;
const HEARD_RETENTION_MS = 3000;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

// Native felt hits share the cushion kind. Use contact height, not ball-center height.
export function isFeltLanding(sound: PoolSound) {
  return (
    sound.kind === "cushion" &&
    sound.y >= FELT_Y - MESH_REST_OFFSET - FELT_LIP_DROP &&
    sound.y <= FELT_Y + MESH_REST_OFFSET
  );
}

export function impactMix(sound: PoolSound) {
  const speed = Number.isFinite(sound.speed) ? clamp(sound.speed, 0, 6) : 0;
  const surface = isFeltLanding(sound)
    ? "felt"
    : isReturnFloorLanding(sound)
      ? "floor"
      : sound.kind;
  const { scale, rate, cutoff } = {
    cue: { scale: 0.65, rate: 0.97, cutoff: 14000 },
    ball: { scale: 0.8, rate: 0.97, cutoff: 14000 },
    cushion: { scale: 0.24, rate: 1.08, cutoff: 1800 },
    pocket: { scale: 0.38, rate: 0.62, cutoff: 900 },
    return: { scale: 0.028, rate: 0.72, cutoff: 800 },
    floor: { scale: 0.48, rate: 0.52, cutoff: 650 },
    felt: { scale: 0.1, rate: 0.9, cutoff: 700 },
  }[surface];
  return {
    sample: surface === "ball" ? "impact" : surface,
    gain:
      speed < 0.035
        ? 0
        : scale *
          (sound.kind === "ball"
            ? clamp((speed - 0.035) / 4, 0, 1) ** 1.5
            : 1 - Math.exp(-speed * 0.75)),
    rate: rate + Math.min(speed, 5) * 0.035,
    cutoff:
      surface === "ball"
        ? 2800 + Math.min(speed / 4, 1) * 11200
        : surface === "cue"
          ? 1800 + Math.min(speed / 4, 1) * 10200
          : cutoff,
  };
}

export function rollingMix(ball: PhysicalBall) {
  const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
  const cabinet = ball.stage === "return";
  const moving =
    (ball.stage === "table" || cabinet) &&
    Number.isFinite(speed) &&
    speed > 0.045;
  return {
    sample: cabinet ? ("cabinet" as const) : ("felt" as const),
    gain: moving
      ? Math.min(speed / 1.5, 1) ** 0.8 * (cabinet ? 0.12 : 0.075)
      : 0,
    rate: Number.isFinite(speed) ? clamp(0.75 + speed * 0.2, 0.75, 1.5) : 0.75,
    cutoff: cabinet ? 1100 : 750,
  };
}

// Both branches share distance loss; the centered signal must not carry across the hall.
export function spatialMix(distance: number) {
  const attenuation = Number.isFinite(distance)
    ? 1 / (1 + 1.3 * (clamp(distance, 1, 30) - 1))
    : 0;
  return { dry: attenuation * 0.75, spatial: attenuation * 0.25 };
}

function pair(sound: PoolSound) {
  return sound.kind === "ball" && sound.otherBallId !== undefined
    ? [
        Math.min(sound.ballId, sound.otherBallId),
        Math.max(sound.ballId, sound.otherBallId),
      ].join(":")
    : `${sound.ballId}:${sound.otherBallId ?? ""}`;
}

// Consume one heard occurrence, never a whole turn: prediction can miss collisions.
export function consumeHeard(
  heard: HeardSound[],
  context: PredictionContext,
  sound: PoolSound,
  now: number,
  source: HeardSound["source"] = "predicted",
) {
  let index = -1,
    nearest = 0.3;
  for (let i = 0; i < heard.length; i++) {
    const entry = heard[i]!;
    if (
      entry.source !== source ||
      now - entry.heardAt > HEARD_RETENTION_MS ||
      now < entry.heardAt ||
      entry.tableId !== context.tableId ||
      entry.rack !== context.rack ||
      entry.turn !== context.turn ||
      entry.sound.kind !== sound.kind ||
      pair(entry.sound) !== pair(sound)
    )
      continue;
    const distance = Math.hypot(
      entry.sound.x - sound.x,
      entry.sound.y - sound.y,
      entry.sound.z - sound.z,
    );
    if (distance < nearest) {
      nearest = distance;
      index = i;
    }
  }
  if (index < 0) return false;
  heard.splice(index, 1);
  return true;
}

export class AudioEventGate {
  private tables = new Map<string, { rack: number; id: number }>();
  private time = -Infinity;
  readonly heard: HeardSound[] = [];

  reset() {
    this.tables.clear();
    this.heard.length = 0;
    this.time = -Infinity;
  }

  begin(time: number, now: number) {
    if (time < this.time) this.reset();
    this.time = time;
    for (let i = this.heard.length - 1; i >= 0; i--)
      if (now - this.heard[i].heardAt > HEARD_RETENTION_MS)
        this.heard.splice(i, 1);
  }

  events(
    tableId: string,
    rack: number,
    sounds: readonly SoundEvent[],
    time: number,
  ) {
    const previous = this.tables.get(tableId);
    const id = Math.max(
      previous?.rack === rack ? previous.id : -1,
      ...sounds.map((sound) => sound.id),
    );
    this.tables.set(tableId, { rack, id });
    if (!previous || previous.rack !== rack) return [];
    return sounds.filter(
      (sound) =>
        sound.id > previous.id &&
        time - sound.time >= 0 &&
        time - sound.time <= EVENT_MAX_AGE,
    );
  }

  retain(tableIds: Set<string>) {
    for (const id of this.tables.keys())
      if (!tableIds.has(id)) this.tables.delete(id);
  }
}
