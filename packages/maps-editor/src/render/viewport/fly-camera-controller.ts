import type { Vec3 } from "../../core/index.js";
import type { EditorViewportKind } from "../types.js";
import { cross, normalize } from "../viewport-geometry.js";

const FLY_BOOST = 4;
const FLY_KEYS = new Set(["w", "s", "a", "d", "q", "x"]);

export interface FlyCameraControllerOptions {
  readonly kind: EditorViewportKind;
  readonly canvas: HTMLCanvasElement;
  readonly forward: () => Vec3;
  readonly speed: () => number;
  readonly translate: (delta: Vec3) => void;
  readonly changed: () => void;
  readonly requestFrame: () => void;
  readonly now?: () => number;
}

/** Owns keyboard fly input and timing without owning camera or GPU state. */
export class FlyCameraController {
  private readonly keys = new Set<string>();
  private readonly now: () => number;
  private lastUpdateTime: number;
  private boosted = false;

  public constructor(private readonly options: FlyCameraControllerOptions) {
    this.now = options.now ?? (() => performance.now());
    this.lastUpdateTime = this.now();
    options.canvas.addEventListener("keydown", this.keyDown);
    options.canvas.addEventListener("keyup", this.keyUp);
    options.canvas.addEventListener("blur", this.blur);
    options.canvas.addEventListener("focus", this.focus);
  }

  public get active(): boolean {
    return this.options.kind === "perspective" && this.keys.size > 0;
  }

  public update(): void {
    const now = this.now();
    const seconds = Math.min(
      0.05,
      Math.max(0, (now - this.lastUpdateTime) / 1000),
    );
    this.lastUpdateTime = now;
    if (!this.active || seconds === 0) return;

    const forward = this.options.forward();
    const right = normalize(cross(forward, [0, 0, 1]));
    const movement: [number, number, number] = [0, 0, 0];
    const accumulate = (direction: Vec3, amount: number) => {
      movement[0] += direction[0] * amount;
      movement[1] += direction[1] * amount;
      movement[2] += direction[2] * amount;
    };
    if (this.keys.has("w")) accumulate(forward, 1);
    if (this.keys.has("s")) accumulate(forward, -1);
    if (this.keys.has("d")) accumulate(right, 1);
    if (this.keys.has("a")) accumulate(right, -1);
    if (this.keys.has("q")) accumulate([0, 0, 1], 1);
    if (this.keys.has("x")) accumulate([0, 0, 1], -1);
    if (Math.hypot(...movement) <= Number.EPSILON) return;

    const direction = normalize(movement);
    const distance =
      this.options.speed() * seconds * (this.boosted ? FLY_BOOST : 1);
    this.options.translate([
      direction[0] * distance,
      direction[1] * distance,
      direction[2] * distance,
    ]);
    this.options.changed();
  }

  public dispose(): void {
    this.keys.clear();
    this.boosted = false;
    this.options.canvas.removeEventListener("keydown", this.keyDown);
    this.options.canvas.removeEventListener("keyup", this.keyUp);
    this.options.canvas.removeEventListener("blur", this.blur);
    this.options.canvas.removeEventListener("focus", this.focus);
  }

  private readonly keyDown = (event: KeyboardEvent) => {
    if (this.options.kind !== "perspective") return;
    const key = event.key.toLowerCase();
    if (key === "shift") {
      this.boosted = true;
      return;
    }
    if (!FLY_KEYS.has(key)) return;
    if (typeof event.shiftKey === "boolean") this.boosted = event.shiftKey;
    event.preventDefault();
    event.stopPropagation();
    const wasIdle = this.keys.size === 0;
    this.keys.add(key);
    if (!wasIdle) return;
    // Reset on the first key transition so time spent idle cannot become one large movement step.
    this.lastUpdateTime = this.now();
    this.options.requestFrame();
  };

  private readonly keyUp = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key === "shift") {
      this.boosted = false;
      return;
    }
    if (!this.keys.has(key)) return;
    event.preventDefault();
    event.stopPropagation();
    this.keys.delete(key);
  };

  private readonly blur = () => {
    this.keys.clear();
    this.boosted = false;
    delete this.options.canvas.dataset.cameraFocused;
  };

  private readonly focus = () => {
    this.options.canvas.dataset.cameraFocused = "true";
  };
}
