import { mat4 } from "wgpu-matrix";

import {
  entityValue,
  bspPlayerProfile,
  perspectiveForward,
  type ParsedWorld,
  type Vec3Tuple,
} from "../core/index.js";
import type { CameraState, CameraUpdate } from "./types.js";

function parseOrigin(value: string | undefined): Vec3Tuple | undefined {
  if (!value) return undefined;
  const values = value.trim().split(/\s+/).map(Number);
  if (
    values.length !== 3 ||
    values.some((component) => !Number.isFinite(component))
  )
    return undefined;
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

export class WorldCamera {
  private state: CameraState = {
    position: [0, 0, 64],
    yaw: 0,
    pitch: 0,
    fieldOfView: 75,
  };

  public get value(): CameraState {
    return {
      ...this.state,
      position: [...this.state.position] as [number, number, number],
    };
  }

  public reset(world: ParsedWorld): void {
    const playerProfile = bspPlayerProfile(world.format);
    const spawn = world.entities.find((entity) =>
      playerProfile.spawnClasses.has(
        entityValue(entity, "classname")?.toLowerCase() ?? "",
      ),
    );
    const origin = parseOrigin(
      spawn ? entityValue(spawn, "origin") : undefined,
    );
    const fallback: Vec3Tuple = [
      (world.bounds.min[0] + world.bounds.max[0]) / 2,
      (world.bounds.min[1] + world.bounds.max[1]) / 2,
      (world.bounds.min[2] + world.bounds.max[2]) / 2,
    ];
    const position = origin ?? fallback;
    const eyeHeight = origin ? playerProfile.eyeHeight : 0;
    const yawDegrees = Number(spawn ? (entityValue(spawn, "angle") ?? 0) : 0);
    this.state = {
      position: [position[0], position[1], position[2] + eyeHeight],
      yaw: (Number.isFinite(yawDegrees) ? yawDegrees : 0) * (Math.PI / 180),
      pitch: 0,
      fieldOfView: 75,
    };
  }

  public update(update: CameraUpdate): void {
    const fieldOfView = update.fieldOfView ?? this.state.fieldOfView;
    const pitch = update.pitch ?? this.state.pitch;
    this.state = {
      position: update.position ?? this.state.position,
      yaw: update.yaw ?? this.state.yaw,
      pitch: Math.max(-Math.PI * 0.49, Math.min(Math.PI * 0.49, pitch)),
      fieldOfView: Math.max(20, Math.min(120, fieldOfView)),
    };
  }

  public move(delta: Vec3Tuple): void {
    this.state = {
      ...this.state,
      position: [
        this.state.position[0] + delta[0],
        this.state.position[1] + delta[1],
        this.state.position[2] + delta[2],
      ],
    };
  }

  public projectionView(aspect: number): Float32Array {
    const { position, yaw, pitch, fieldOfView } = this.state;
    const forward = perspectiveForward(yaw, pitch);
    const target: Vec3Tuple = [
      position[0] + forward[0],
      position[1] + forward[1],
      position[2] + forward[2],
    ];
    const view = mat4.lookAt(position, target, [0, 0, 1]);
    const projection = mat4.perspective(
      (fieldOfView * Math.PI) / 180,
      Math.max(0.001, aspect),
      1,
      65_536,
    );
    return mat4.multiply(projection, view);
  }
}
