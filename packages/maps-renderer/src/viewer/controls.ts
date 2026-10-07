import {
  bspPlayerProfile,
  createGoldSrcMovementState,
  entityValue,
  moveGoldSrcPlayer,
  tracePlayerHull,
  DEFAULT_GOLDSRC_MOVEMENT,
  type GoldSrcMovementState,
  type ParsedWorld,
  type Vec3Tuple,
} from "../core/index.js";
import { WorldCamera } from "./camera.js";
import type {
  WorldviewMovementMode,
  WorldviewMovementSettings,
  WorldviewMovementUpdate,
} from "./types.js";

const FIXED_COMMAND_SECONDS = 0.01;
const MAX_ACCUMULATED_SECONDS = 0.1;
const GOLDSRC_MOUSE_YAW_DEGREES = 0.022;
const COUNTER_STRIKE_MAX_SPEED = 250;

export const DEFAULT_WORLDVIEW_MOVEMENT: WorldviewMovementSettings = {
  maxSpeed: DEFAULT_GOLDSRC_MOVEMENT.maxSpeed,
  accelerate: DEFAULT_GOLDSRC_MOVEMENT.accelerate,
  airAccelerate: DEFAULT_GOLDSRC_MOVEMENT.airAccelerate,
  friction: DEFAULT_GOLDSRC_MOVEMENT.friction,
  stopSpeed: DEFAULT_GOLDSRC_MOVEMENT.stopSpeed,
  edgeFriction: DEFAULT_GOLDSRC_MOVEMENT.edgeFriction,
  mouseSensitivity: 3,
  mouseAcceleration: 0,
  viewBob: 1,
};

export interface PlayerSoundEvent {
  readonly kind: "step" | "jump" | "land";
  readonly origin: Vec3Tuple;
  readonly strength: number;
}

type ControllableMode = Exclude<WorldviewMovementMode, "none">;

function samePosition(left: Vec3Tuple, right: Vec3Tuple): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function finiteInRange(
  value: number,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function normalizedSettings(
  current: WorldviewMovementSettings,
  update: WorldviewMovementUpdate,
): WorldviewMovementSettings {
  return {
    maxSpeed: finiteInRange(
      update.maxSpeed ?? current.maxSpeed,
      current.maxSpeed,
      1,
      2_000,
    ),
    accelerate: finiteInRange(
      update.accelerate ?? current.accelerate,
      current.accelerate,
      0,
      100,
    ),
    airAccelerate: finiteInRange(
      update.airAccelerate ?? current.airAccelerate,
      current.airAccelerate,
      0,
      100,
    ),
    friction: finiteInRange(
      update.friction ?? current.friction,
      current.friction,
      0,
      20,
    ),
    stopSpeed: finiteInRange(
      update.stopSpeed ?? current.stopSpeed,
      current.stopSpeed,
      0,
      1_000,
    ),
    edgeFriction: finiteInRange(
      update.edgeFriction ?? current.edgeFriction,
      current.edgeFriction,
      0,
      10,
    ),
    mouseSensitivity: finiteInRange(
      update.mouseSensitivity ?? current.mouseSensitivity,
      current.mouseSensitivity,
      0.01,
      100,
    ),
    mouseAcceleration: finiteInRange(
      update.mouseAcceleration ?? current.mouseAcceleration,
      current.mouseAcceleration,
      0,
      1,
    ),
    viewBob: finiteInRange(
      update.viewBob ?? current.viewBob,
      current.viewBob,
      0,
      2,
    ),
  };
}

function isCounterStrikeWorld(world: ParsedWorld): boolean {
  const markers = new Set([
    "func_bomb_target",
    "func_buyzone",
    "hostage_entity",
    "info_bomb_target",
    "info_hostage_rescue",
  ]);
  return world.entities.some((entity) => {
    const classname = entityValue(entity, "classname");
    return classname !== undefined && markers.has(classname.toLowerCase());
  });
}

export class WorldControls {
  private readonly pressed = new Set<string>();
  private disposed = false;
  private readonly initialTabIndex: string | null;
  private world: ParsedWorld | null = null;
  private movement: GoldSrcMovementState | null = null;
  private spawnOrigin: Vec3Tuple = [0, 0, 0];
  private eyeHeight = 28;
  private accumulator = 0;
  private stepSoundCooldown = 0;
  private bobTime = 0;
  private bobOffset = 0;
  private smoothedOriginZ = 0;
  private pendingToggle = false;
  private desiredMode: ControllableMode;
  private currentMode: ControllableMode;
  private settingsValue: WorldviewMovementSettings;
  private automaticMaxSpeed: boolean;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    initialMode: ControllableMode,
    private readonly changed: (look?: { yaw: number; pitch: number }) => void,
    private readonly modeChanged: (mode: ControllableMode) => void,
    private readonly playerSound: (event: PlayerSoundEvent) => void,
    initialSettings: WorldviewMovementUpdate = {},
  ) {
    this.desiredMode = initialMode;
    this.currentMode = initialMode;
    this.automaticMaxSpeed = initialSettings.maxSpeed === undefined;
    this.settingsValue = normalizedSettings(
      DEFAULT_WORLDVIEW_MOVEMENT,
      initialSettings,
    );
    this.initialTabIndex = canvas.getAttribute("tabindex");
    if (canvas.tabIndex < 0) canvas.tabIndex = 0;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("keydown", this.onKeyDown);
    canvas.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("blur", this.onBlur);
    canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  public get mode(): ControllableMode {
    return this.currentMode;
  }

  public get active(): boolean {
    return (
      this.pressed.size > 0 ||
      this.pendingToggle ||
      this.pointerLocked ||
      (this.currentMode === "walk" &&
        this.movement !== null &&
        !this.movement.onGround)
    );
  }

  public get settings(): WorldviewMovementSettings {
    return { ...this.settingsValue };
  }

  public setSettings(update: WorldviewMovementUpdate): void {
    if (update.maxSpeed !== undefined) this.automaticMaxSpeed = false;
    this.settingsValue = normalizedSettings(this.settingsValue, update);
    this.changed();
  }

  /** Returns true when the map has no standing hull and walking had to fall back to noclip. */
  public setWorld(world: ParsedWorld, camera: WorldCamera): boolean {
    this.world = world;
    if (this.automaticMaxSpeed) {
      this.settingsValue = {
        ...this.settingsValue,
        maxSpeed: isCounterStrikeWorld(world)
          ? COUNTER_STRIKE_MAX_SPEED
          : DEFAULT_WORLDVIEW_MOVEMENT.maxSpeed,
      };
    }
    this.eyeHeight = bspPlayerProfile(world.format).eyeHeight;
    this.spawnOrigin = this.originFromCamera(camera.value.position);
    this.movement = createGoldSrcMovementState(this.spawnOrigin);
    this.accumulator = 0;
    this.resetViewResponse(this.spawnOrigin[2]);
    const hasStandingHull = Boolean(
      world.collision &&
      world.models[0] &&
      (world.models[0].headnodes[1] ?? -1) >= 0,
    );
    const nextMode =
      this.desiredMode === "walk" && !hasStandingHull
        ? "fly"
        : this.desiredMode;
    this.updateMode(nextMode);
    return this.desiredMode === "walk" && !hasStandingHull;
  }

  public setMode(mode: ControllableMode, camera: WorldCamera): boolean {
    this.desiredMode = mode;
    if (mode === "walk" && !this.canWalk()) return false;
    if (mode === "walk") this.placePlayerAtCamera(camera);
    this.updateMode(mode);
    this.changed();
    return true;
  }

  public synchronizeCamera(camera: WorldCamera): void {
    if (this.currentMode === "walk") this.placePlayerAtCamera(camera);
  }

  public update(camera: WorldCamera, deltaSeconds: number): boolean {
    if (this.pendingToggle) {
      this.pendingToggle = false;
      const next = this.currentMode === "walk" ? "fly" : "walk";
      this.setMode(next, camera);
    }
    return this.currentMode === "walk"
      ? this.updateWalking(camera, deltaSeconds)
      : this.updateFlying(camera, deltaSeconds);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pressed.clear();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("keydown", this.onKeyDown);
    this.canvas.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    if (this.initialTabIndex === null) this.canvas.removeAttribute("tabindex");
    else this.canvas.setAttribute("tabindex", this.initialTabIndex);
  }

  private updateWalking(camera: WorldCamera, deltaSeconds: number): boolean {
    const world = this.world;
    let movement = this.movement;
    if (!world || !movement || !this.canWalk()) return false;
    const before = movement.origin;
    const settings = this.settingsValue;
    const movementConfig = {
      ...DEFAULT_GOLDSRC_MOVEMENT,
      maxSpeed: settings.maxSpeed,
      accelerate: settings.accelerate,
      airAccelerate: settings.airAccelerate,
      friction: settings.friction,
      stopSpeed: settings.stopSpeed,
      edgeFriction: settings.edgeFriction,
    };
    this.accumulator = Math.min(
      MAX_ACCUMULATED_SECONDS,
      this.accumulator + Math.max(0, deltaSeconds),
    );
    while (this.accumulator >= FIXED_COMMAND_SECONDS) {
      const state = camera.value;
      const result = moveGoldSrcPlayer(
        world,
        movement,
        {
          forward:
            Number(this.pressed.has("KeyW")) - Number(this.pressed.has("KeyS")),
          side:
            Number(this.pressed.has("KeyD")) - Number(this.pressed.has("KeyA")),
          yaw: state.yaw,
          jump: this.pressed.has("Space"),
          speedScale:
            this.pressed.has("ShiftLeft") || this.pressed.has("ShiftRight")
              ? 0.3
              : 1,
        },
        FIXED_COMMAND_SECONDS,
        movementConfig,
      );
      movement = result.state;
      this.accumulator -= FIXED_COMMAND_SECONDS;
      this.stepSoundCooldown = Math.max(
        0,
        this.stepSoundCooldown - FIXED_COMMAND_SECONDS,
      );

      if (result.jumped) {
        this.playerSound({
          kind: "jump",
          origin: movement.origin,
          strength: 1,
        });
      }
      if (result.landed && result.landingSpeed > 120) {
        this.playerSound({
          kind: "land",
          origin: movement.origin,
          strength: Math.min(1, result.landingSpeed / 500),
        });
        this.stepSoundCooldown = 0;
      }
      const horizontalSpeed = Math.hypot(
        movement.velocity[0],
        movement.velocity[1],
      );
      if (
        movement.onGround &&
        horizontalSpeed >= 120 &&
        this.stepSoundCooldown <= 0
      ) {
        const walking = horizontalSpeed < 210;
        this.stepSoundCooldown = walking ? 0.4 : 0.3;
        this.playerSound({
          kind: "step",
          origin: movement.origin,
          strength: walking ? 0.2 : 0.5,
        });
      }

      if (movement.origin[2] < world.bounds.min[2] - 512) {
        movement = createGoldSrcMovementState(this.spawnOrigin);
        this.resetViewResponse(this.spawnOrigin[2]);
      }
    }
    this.movement = movement;
    const viewZ = this.viewHeight(movement, Math.max(0, deltaSeconds));
    camera.update({
      position: [movement.origin[0], movement.origin[1], viewZ],
    });
    return !samePosition(before, movement.origin);
  }

  private updateFlying(camera: WorldCamera, deltaSeconds: number): boolean {
    if (this.pressed.size === 0) return false;
    const state = camera.value;
    const speed =
      (this.pressed.has("ShiftLeft") || this.pressed.has("ShiftRight")
        ? 600
        : 320) * deltaSeconds;
    const forward =
      Number(this.pressed.has("KeyW")) - Number(this.pressed.has("KeyS"));
    const side =
      Number(this.pressed.has("KeyD")) - Number(this.pressed.has("KeyA"));
    const vertical =
      Number(this.pressed.has("Space")) -
      Number(
        this.pressed.has("KeyC") ||
          this.pressed.has("ControlLeft") ||
          this.pressed.has("ControlRight") ||
          this.pressed.has("ArrowDown"),
      );
    const length = Math.hypot(forward, side, vertical) || 1;
    const delta: Vec3Tuple = [
      ((Math.cos(state.yaw) * forward +
        Math.cos(state.yaw - Math.PI / 2) * side) *
        speed) /
        length,
      ((Math.sin(state.yaw) * forward +
        Math.sin(state.yaw - Math.PI / 2) * side) *
        speed) /
        length,
      (vertical * speed) / length,
    ];
    camera.move(delta);
    return true;
  }

  private canWalk(): boolean {
    return Boolean(
      this.world?.collision &&
      this.world.models[0] &&
      (this.world.models[0].headnodes[1] ?? -1) >= 0,
    );
  }

  private originFromCamera(position: Vec3Tuple): Vec3Tuple {
    return [position[0], position[1], position[2] - this.eyeHeight];
  }

  private placePlayerAtCamera(camera: WorldCamera): void {
    const world = this.world;
    if (!world) return;
    const requested = this.originFromCamera(camera.value.position);
    const offsets: readonly Vec3Tuple[] = [
      [0, 0, 0],
      [0, 0, 1],
      [0, 0, 2],
      [0, 0, 4],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 8],
      [8, 0, 0],
      [-8, 0, 0],
      [0, 8, 0],
      [0, -8, 0],
    ];
    const origin = offsets
      .map(
        (offset) =>
          [
            requested[0] + offset[0],
            requested[1] + offset[1],
            requested[2] + offset[2],
          ] as Vec3Tuple,
      )
      .find((candidate) => {
        const trace = tracePlayerHull(world, candidate, candidate);
        return !trace.startSolid && !trace.allSolid;
      });
    this.movement = createGoldSrcMovementState(origin ?? requested);
    this.accumulator = 0;
    this.resetViewResponse((origin ?? requested)[2]);
  }

  private resetViewResponse(originZ: number): void {
    this.stepSoundCooldown = 0;
    this.bobTime = 0;
    this.bobOffset = 0;
    this.smoothedOriginZ = originZ;
  }

  /** Applies classic view bob and stair-step camera smoothing. */
  private viewHeight(
    movement: GoldSrcMovementState,
    deltaSeconds: number,
  ): number {
    const originZ = movement.origin[2];
    if (movement.onGround && originZ - this.smoothedOriginZ > 0) {
      this.smoothedOriginZ = Math.min(
        originZ,
        this.smoothedOriginZ + deltaSeconds * 150,
      );
      this.smoothedOriginZ = Math.max(this.smoothedOriginZ, originZ - 18);
    } else {
      this.smoothedOriginZ = originZ;
    }

    if (movement.onGround) {
      this.bobTime += deltaSeconds;
      const normalizedCycle = (this.bobTime % 0.8) / 0.8;
      const cycle =
        normalizedCycle < 0.5
          ? (Math.PI * normalizedCycle) / 0.5
          : Math.PI + (Math.PI * (normalizedCycle - 0.5)) / 0.5;
      const speed = Math.hypot(movement.velocity[0], movement.velocity[1]);
      const amplitude = speed * 0.01 * this.settingsValue.viewBob;
      this.bobOffset = Math.min(
        4,
        Math.max(-7, amplitude * 0.3 + amplitude * 0.7 * Math.sin(cycle)),
      );
    }

    return this.smoothedOriginZ + this.eyeHeight + this.bobOffset;
  }

  private updateMode(mode: ControllableMode): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    this.accumulator = 0;
    this.pressed.clear();
    this.modeChanged(mode);
  }

  private readonly onPointerDown = (): void => {
    this.canvas.focus({ preventScroll: true });
    void this.canvas.requestPointerLock();
  };

  private get pointerLocked(): boolean {
    return (
      (this.canvas.getRootNode() as Document | ShadowRoot)
        .pointerLockElement === this.canvas
    );
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked) return;
    const distance = Math.hypot(event.movementX, event.movementY);
    const sensitivity =
      this.settingsValue.mouseSensitivity +
      distance * this.settingsValue.mouseAcceleration;
    const radiansPerCount =
      (GOLDSRC_MOUSE_YAW_DEGREES * sensitivity * Math.PI) / 180;
    this.changed({
      yaw: -event.movementX * radiansPerCount,
      pitch: -event.movementY * radiansPerCount,
    });
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isMovementKey(event.code)) return;
    event.preventDefault();
    if (event.code === "KeyV") {
      if (!event.repeat) this.pendingToggle = true;
    } else {
      this.pressed.add(event.code);
    }
    this.changed();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!this.isMovementKey(event.code)) return;
    event.preventDefault();
    this.pressed.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.pressed.clear();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.pointerLocked) event.preventDefault();
  };

  private isMovementKey(code: string): boolean {
    return [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "KeyC",
      "KeyV",
      "Space",
      "ShiftLeft",
      "ShiftRight",
      "ControlLeft",
      "ControlRight",
      "ArrowDown",
    ].includes(code);
  }
}
