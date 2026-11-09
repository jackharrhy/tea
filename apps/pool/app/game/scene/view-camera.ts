import { TABLE_HALF_WIDTH as W, TABLE_HALF_LENGTH as L } from "@tea/pool";
import { FELT_Y, RAIL_WIDTH, RAIL_TOP_Y } from "@tea/pool/table";
import { MathUtils, PerspectiveCamera, Vector3 } from "three";

type Mode = "hall" | "table";
type Orbit = { yaw: number; tilt: number; zoom: number; pan: Vector3 };
const orbit = (): Orbit => ({ yaw: 0, tilt: 0, zoom: 1, pan: new Vector3() });

export class ViewCamera {
  private mode: Mode = "hall";
  private layout = "";
  private alignYaw = true;
  private views = { hall: orbit(), table: orbit() };
  private focus = new Vector3(0, 0.5, 0);
  private yaw: number;
  private elevation: number;
  private distance: number;

  constructor(private camera: PerspectiveCamera) {
    const offset = camera.position.clone().sub(this.focus);
    this.yaw = Math.atan2(offset.x, offset.z);
    this.elevation = Math.atan2(offset.y, Math.hypot(offset.x, offset.z));
    this.distance = offset.length();
  }
  orbitBy(dx: number, dy: number) {
    const view = this.views[this.mode];
    view.yaw -= dx * 0.006;
    view.tilt = MathUtils.clamp(
      view.tilt + dy * 0.005,
      this.mode === "table" ? -0.75 : -0.3,
      0.45,
    );
  }
  panBy(dx: number, dy: number, viewportHeight: number) {
    const scale =
      (2 * this.distance * Math.tan(MathUtils.degToRad(this.camera.fov / 2))) /
      Math.max(1, viewportHeight);
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.views[this.mode].pan
      .addScaledVector(right, -dx * scale)
      .addScaledVector(forward, dy * scale)
      .clampLength(0, this.mode === "hall" ? 7 : 1.8);
  }
  zoomBy(delta: number) {
    const view = this.views[this.mode];
    view.zoom = MathUtils.clamp(
      view.zoom * Math.exp(delta * 0.001),
      this.mode === "hall" ? 0.58 : 0.78,
      this.mode === "hall" ? 1.9 : 1.65,
    );
  }
  recenter() {
    this.views[this.mode] = orbit();
    this.alignYaw = true;
  }
  movement(horizontal: number, vertical: number) {
    const x = horizontal * Math.cos(this.yaw) + vertical * Math.sin(this.yaw);
    const z = -horizontal * Math.sin(this.yaw) + vertical * Math.cos(this.yaw);
    const scale = Math.max(1, Math.hypot(x, z));
    return { x: x / scale, z: z / scale };
  }
  update(dt: number, anchor: Vector3, mode: Mode, mobile: boolean) {
    this.mode = mode;
    const view = this.views[mode];
    const offset =
      mode === "table"
        ? new Vector3(0, 7.3, 3.8)
        : new Vector3(
            mobile ? 6.1 : 5.4,
            mobile ? 9.7 : 7.6,
            mobile ? 7.9 : 6.8,
          );
    const baseYaw = Math.atan2(offset.x, offset.z);
    let yaw = baseYaw + view.yaw;
    const layout = `${mode}:${mobile}`;
    if (this.alignYaw || layout !== this.layout) {
      yaw =
        this.yaw +
        Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
      view.yaw = yaw - baseYaw;
      this.alignYaw = false;
      this.layout = layout;
    }
    const elevation = MathUtils.clamp(
      Math.atan2(offset.y, Math.hypot(offset.x, offset.z)) + view.tilt,
      0.45,
      1.35,
    );
    let distance = offset.length();
    if (mode === "table") {
      const backward = new Vector3(
        Math.sin(yaw) * Math.cos(elevation),
        Math.sin(elevation),
        Math.cos(yaw) * Math.cos(elevation),
      );
      const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const up = new Vector3().crossVectors(backward, right);
      const vertical = Math.tan(MathUtils.degToRad(this.camera.fov / 2)) * 0.9;
      const horizontal = vertical * this.camera.aspect;
      distance = 0;
      for (const x of [-W - RAIL_WIDTH, W + RAIL_WIDTH])
        for (const z of [-L - RAIL_WIDTH, L + RAIL_WIDTH]) {
          const corner = new Vector3(x, RAIL_TOP_Y - FELT_Y, z);
          distance = Math.max(
            distance,
            corner.dot(backward) + Math.abs(corner.dot(right)) / horizontal,
            corner.dot(backward) + Math.abs(corner.dot(up)) / vertical,
          );
        }
    }
    const ease = 1 - Math.exp(-dt * 9);
    this.yaw += (yaw - this.yaw) * ease;
    this.elevation = MathUtils.lerp(this.elevation, elevation, ease);
    this.distance = MathUtils.lerp(this.distance, distance * view.zoom, ease);
    this.focus.lerp(anchor.clone().add(view.pan), 1 - Math.exp(-dt * 6));
    const groundDistance = Math.cos(this.elevation) * this.distance;
    this.camera.position.set(
      this.focus.x + Math.sin(this.yaw) * groundDistance,
      this.focus.y + Math.sin(this.elevation) * this.distance,
      this.focus.z + Math.cos(this.yaw) * groundDistance,
    );
    this.camera.lookAt(this.focus);
  }
}
