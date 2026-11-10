import { expect, test } from "bun:test";
import { listenerPose } from "../../app/game/audio-listener";

test("hall hearing stays at avatar ear level as the camera changes pitch", () => {
  const low = listenerPose(
    { x: 2, z: 3 },
    null,
    { x: 0, y: -0.1, z: -1 },
    0.78,
  );
  const high = listenerPose(
    { x: 2, z: 3 },
    null,
    { x: 0, y: -0.99, z: -0.1 },
    0.78,
  );
  expect(high).toEqual(low);
  expect(high.position).toEqual({ x: 2, y: 1.35, z: 3 });
});
test("table focus moves ears close without using the elevated camera position", () => {
  const pose = listenerPose(
    { x: 20, z: 30 },
    { x: 2, z: -2 },
    { x: 1, y: -1, z: 0 },
    0.78,
  );
  expect(pose.position.x).toBeCloseTo(1.65);
  expect(pose.position.y).toBeCloseTo(1.33);
  expect(pose.position.z).toBe(-2);
  expect(pose.forward).toEqual({ x: 1, y: 0, z: 0 });
  expect(
    listenerPose({ x: 0, z: 0 }, null, { x: 0, y: -1, z: 0 }, 0.78).forward,
  ).toEqual({
    x: 0,
    y: 0,
    z: -1,
  });
});
