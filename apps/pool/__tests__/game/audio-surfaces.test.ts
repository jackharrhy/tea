import { expect, test } from "bun:test";
import { PoolPhysics } from "@tea/pool/engine";
import { createShotResult } from "@tea/pool";
import type { PoolSound } from "@tea/pool";
import { Quaternion, Vector3 } from "three";
import {
  RETURN_FLOOR,
  RETURN_FLOOR_POINT,
  isReturnFloorLanding,
} from "../../app/game/audio-surfaces";
import { impactMix } from "../../app/game/audio-mix";

const floorSound: PoolSound = {
  kind: "return",
  ballId: 1,
  speed: 1,
  x: RETURN_FLOOR_POINT.x,
  y: RETURN_FLOOR_POINT.y,
  z: RETURN_FLOOR_POINT.z,
};
const contact = (x: number, y: number, z: number): PoolSound => {
  const p = new Vector3(x, y, z)
    .applyQuaternion(new Quaternion(...RETURN_FLOOR.rotation))
    .add(new Vector3(...RETURN_FLOOR.center));
  return { ...floorSound, x: p.x, y: p.y, z: p.z };
};

test("receiving floor classification follows the rotated top face and bounded footprint", () => {
  const [width, height, length] = RETURN_FLOOR.size;
  expect(isReturnFloorLanding(floorSound)).toBe(true);
  expect(
    isReturnFloorLanding(contact(width * 0.4, height / 2, length * 0.4)),
  ).toBe(true);
  for (const sound of [
    contact(width, height / 2, 0),
    contact(0, height / 2, length),
    contact(0, -height / 2, 0),
    contact(0, height / 2 + 0.03, 0),
    { ...floorSound, y: 0.6 },
    { ...floorSound, x: NaN },
    { ...floorSound, kind: "ball" as const },
    { ...floorSound, kind: "pocket" as const },
  ])
    expect(isReturnFloorLanding(sound)).toBe(false);
});

test("floor landing has a deeper audible body without the weak ball-contact curve", () => {
  const floor = impactMix(floorSound);
  const lane = impactMix({ ...floorSound, y: 0.6 });
  const softBall = impactMix({ ...floorSound, kind: "ball", speed: 0.5 });
  expect(floor.sample).toBe("floor");
  expect(lane.sample).toBe("return");
  expect(floor.gain).toBeGreaterThan(lane.gain);
  expect(floor.rate).toBeLessThan(lane.rate);
  expect(floor.cutoff).toBeLessThan(lane.cutoff);
  expect(impactMix({ ...floorSound, speed: 0.5 }).gain).toBeGreaterThan(
    softBall.gain,
  );
});

test("an actual ball drop through the lane gap selects the receiving-floor body", () => {
  const physics = new PoolPhysics([
    {
      id: 1,
      x: 0,
      y: 0.6,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      pocketed: true,
      stage: "return",
      q: [0, 0, 0, 1],
      w: [0, 0, 0],
      revision: 1,
    },
  ]);
  const contacts: PoolSound[] = [];
  try {
    for (let tick = 0; tick < 120; tick++) {
      physics.step(1 / 60, createShotResult());
      contacts.push(
        ...physics.sounds.filter((sound) => sound.kind === "return"),
      );
    }
    expect(contacts.some((sound) => impactMix(sound).sample === "floor")).toBe(
      true,
    );
    expect(contacts.some((sound) => impactMix(sound).sample === "return")).toBe(
      true,
    );
  } finally {
    physics.dispose();
  }
});
