import { Quaternion } from "three";
import type { RecordedShot } from "@harrhy/pool/recording";

export function shotDuration(shot: RecordedShot): number {
  return shot.frames.at(-1)?.at ?? 0;
}

/** Sample only recorded poses; discrete ball properties change at their recorded frame. */
export function sampleShot(shot: RecordedShot, at: number) {
  let low = 0,
    high = shot.frames.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (shot.frames[mid]!.at <= at) low = mid + 1;
    else high = mid;
  }
  const before = low ? shot.frames[low - 1]! : { at: 0, balls: shot.initial };
  const after = shot.frames[low];
  if (!after || at <= before.at) return before.balls;
  const t = (at - before.at) / (after.at - before.at);
  return before.balls.map((ball) => {
    const next = after.balls.find((other) => other.id === ball.id)!;
    if (ball.revision !== next.revision) return ball;
    const q = new Quaternion(...ball.q).slerp(new Quaternion(...next.q), t);
    return {
      ...ball,
      x: ball.x + (next.x - ball.x) * t,
      y: ball.y + (next.y - ball.y) * t,
      z: ball.z + (next.z - ball.z) * t,
      q: q.toArray() as [number, number, number, number],
    };
  });
}
