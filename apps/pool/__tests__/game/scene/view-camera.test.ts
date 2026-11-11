import { TABLE_HALF_WIDTH as W, TABLE_HALF_LENGTH as L } from "@harrhy/pool";
import { FELT_Y, RAIL_WIDTH, RAIL_TOP_Y, POCKETS } from "@harrhy/pool/table";
import { describe, expect, test } from "bun:test";
import { PerspectiveCamera, Vector3 } from "three";
import { ViewCamera } from "../../../app/game/scene/view-camera";
function setup() {
  const camera = new PerspectiveCamera(43, 1, 0.1, 100);
  camera.position.set(7.5, 11, 9.5);
  const rig = new ViewCamera(camera);
  const anchor = new Vector3(0, 0.5, 0);
  const settle = (mode: "hall" | "table" = "hall") => {
    for (let i = 0; i < 120; i++) rig.update(1 / 60, anchor, mode, false);
  };
  settle();
  return { camera, rig, anchor, settle };
}
describe("game camera", () => {
  test("orbit eases around its focus and walking follows the visible view", () => {
    const { camera, rig, anchor, settle } = setup();
    const original = camera.position.clone(),
      radius = original.distanceTo(anchor);
    rig.orbitBy(160, 0);
    rig.update(1 / 60, anchor, "hall", false);
    expect(camera.position.distanceTo(original)).toBeGreaterThan(0.1);
    expect(camera.position.distanceTo(anchor)).toBeCloseTo(radius, 6);
    const first = camera.position.clone();
    settle();
    expect(first.distanceTo(camera.position)).toBeGreaterThan(3);
    const forward = rig.movement(0, -1);
    const towardFocus = anchor.clone().sub(camera.position).setY(0).normalize();
    expect(forward.x).toBeCloseTo(towardFocus.x, 5);
    expect(forward.z).toBeCloseTo(towardFocus.z, 5);
    expect(Math.hypot(...Object.values(rig.movement(1, 1)))).toBeCloseTo(1, 6);
  });
  test("a fast drag keeps its direction across a half-turn and reset takes the short path", () => {
    const { camera, rig, anchor, settle } = setup();
    const original = camera.position.clone();
    const before = Math.atan2(camera.position.x, camera.position.z);
    rig.orbitBy(600, 0);
    rig.update(1 / 60, anchor, "hall", false);
    const after = Math.atan2(camera.position.x, camera.position.z);
    expect(
      Math.atan2(Math.sin(after - before), Math.cos(after - before)),
    ).toBeLessThan(0);
    settle();
    rig.recenter();
    settle();
    expect(camera.position.distanceTo(original)).toBeLessThan(0.001);
  });
  test("extreme orbit and wheel input stay above the floor and within zoom bounds", () => {
    const { camera, rig, anchor, settle } = setup();
    const radius = camera.position.distanceTo(anchor);
    rig.orbitBy(100000, -100000);
    rig.zoomBy(-100000);
    settle();
    expect(camera.position.distanceTo(anchor)).toBeCloseTo(radius * 0.58, 5);
    expect(camera.position.y).toBeGreaterThan(1);
    rig.zoomBy(100000);
    settle();
    expect(camera.position.distanceTo(anchor)).toBeCloseTo(radius * 1.9, 5);
  });
  test("pan is bounded, reset restores framing, and hall/table views keep separate settings", () => {
    const { camera, rig, settle } = setup();
    const original = camera.position.clone();
    rig.panBy(100000, 100000, 900);
    settle();
    expect(camera.position.distanceTo(original)).toBeCloseTo(7, 4);
    rig.recenter();
    settle();
    expect(camera.position.distanceTo(original)).toBeLessThan(0.001);
    rig.orbitBy(120, 40);
    rig.zoomBy(-200);
    settle();
    const hall = camera.position.clone();
    settle("table");
    rig.panBy(500, 0, 900);
    rig.zoomBy(300);
    settle("table");
    settle("hall");
    expect(camera.position.distanceTo(hall)).toBeLessThan(0.001);
  });
});

test("full-screen table framing keeps every pocket inside portrait, desktop and short landscape views", () => {
  for (const [width, height] of [
    [390, 844],
    [1440, 1000],
    [844, 390],
  ]) {
    const camera = new PerspectiveCamera(43, width / height, 0.1, 100);
    camera.position.set(9, 13, 13);
    const rig = new ViewCamera(camera),
      anchor = new Vector3(0, FELT_Y, 0);
    for (let i = 0; i < 180; i++)
      rig.update(1 / 60, anchor, "table", width < 700);
    camera.updateMatrixWorld();
    const points = [
      ...POCKETS.map(({ x, z }) => new Vector3(x, FELT_Y, z)),
      ...[-W - RAIL_WIDTH, W + RAIL_WIDTH].flatMap((x) =>
        [-L - RAIL_WIDTH, L + RAIL_WIDTH].map(
          (z) => new Vector3(x, RAIL_TOP_Y, z),
        ),
      ),
    ];
    for (const [dx, dy] of [
      [0, 0],
      [160, -100],
      [300, 180],
    ]) {
      rig.orbitBy(dx, dy);
      for (let i = 0; i < 180; i++)
        rig.update(1 / 60, anchor, "table", width < 700);
      camera.updateMatrixWorld();
      const projected = points.map((point) => point.clone().project(camera));
      for (const point of projected) {
        expect(Math.abs(point.x)).toBeLessThan(0.94);
        expect(Math.abs(point.y)).toBeLessThan(0.94);
      }
      expect(
        Math.max(...projected.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)])),
      ).toBeGreaterThan(0.88);
      const center = anchor.clone().project(camera);
      expect(center.x).toBeCloseTo(0, 5);
      expect(center.y).toBeCloseTo(0, 5);
    }
  }
});
