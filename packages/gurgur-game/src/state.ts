export type PersistedLinearMover = {
  kind: "linear-mover";
  authoredId: string;
  progress: number;
  direction: -1 | 0 | 1;
  resumeAtTick: number;
};

export type PersistedTrigger = {
  kind: "trigger";
  authoredId: string;
  readyAtTick: number;
  consumed: boolean;
};

export type PersistedRelay = {
  kind: "relay";
  authoredId: string;
  fired: boolean;
};

export type PersistedButton = {
  kind: "button";
  authoredId: string;
  readyAtTick: number;
};

export type PersistedPhysicsControl = {
  kind: "physics-control";
  authoredId: string;
  enabled: boolean;
  reversed: boolean;
};

export type PersistedPlayerState = {
  persistentId: string;
  position: Vec3;
  yaw: number;
  verticalVelocity: number;
  grounded: boolean;
  lastJumpCounter: number;
  stepCooldown: number;
  crouched: boolean;
  grabbedAuthoredId: string | null;
  grabDistance: number;
};

export type PersistedGameState = {
  entities: Array<
    | PersistedLinearMover
    | PersistedTrigger
    | PersistedRelay
    | PersistedButton
    | PersistedPhysicsControl
  >;
  delayedSignals: Array<{ target: string; dueTick: number }>;
};

export function encodePersistedGameState(state: PersistedGameState): string {
  validatePersistedGameState(state);
  return JSON.stringify({
    entities: [...state.entities].toSorted((left, right) =>
      left.authoredId.localeCompare(right.authoredId),
    ),
    delayedSignals: [...state.delayedSignals].toSorted(
      (left, right) =>
        left.dueTick - right.dueTick || left.target.localeCompare(right.target),
    ),
  });
}

export function decodePersistedGameState(json: string): PersistedGameState {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("persisted game state is not valid JSON");
  }
  validatePersistedGameState(value);
  return value;
}

export function validatePersistedGameState(
  value: unknown,
): asserts value is PersistedGameState {
  if (
    !record(value) ||
    !Array.isArray(value.entities) ||
    !Array.isArray(value.delayedSignals)
  )
    throw new Error(
      "persisted game state must contain entity and delayed-signal arrays",
    );
  exact(value, ["entities", "delayedSignals"]);
  const ids = new Set<string>();
  for (const entity of value.entities) {
    if (!record(entity) || typeof entity.kind !== "string")
      throw new Error("persisted game entity is invalid");
    if (typeof entity.authoredId !== "string" || entity.authoredId.length === 0)
      throw new Error("persisted game entity authoredId is invalid");
    if (ids.has(entity.authoredId))
      throw new Error(`duplicate persisted game entity ${entity.authoredId}`);
    ids.add(entity.authoredId);
    if (entity.kind === "linear-mover") {
      exact(entity, [
        "kind",
        "authoredId",
        "progress",
        "direction",
        "resumeAtTick",
      ]);
      if (
        !finite(entity.progress) ||
        entity.progress < 0 ||
        entity.progress > 1 ||
        (entity.direction !== -1 &&
          entity.direction !== 0 &&
          entity.direction !== 1) ||
        !tick(entity.resumeAtTick)
      )
        throw new Error("persisted linear mover is invalid");
    } else if (entity.kind === "trigger") {
      exact(entity, ["kind", "authoredId", "readyAtTick", "consumed"]);
      if (!tick(entity.readyAtTick) || typeof entity.consumed !== "boolean")
        throw new Error("persisted trigger is invalid");
    } else if (entity.kind === "relay") {
      exact(entity, ["kind", "authoredId", "fired"]);
      if (typeof entity.fired !== "boolean")
        throw new Error("persisted relay is invalid");
    } else if (entity.kind === "button") {
      exact(entity, ["kind", "authoredId", "readyAtTick"]);
      if (!tick(entity.readyAtTick))
        throw new Error("persisted button is invalid");
    } else if (entity.kind === "physics-control") {
      exact(entity, ["kind", "authoredId", "enabled", "reversed"]);
      if (
        typeof entity.enabled !== "boolean" ||
        typeof entity.reversed !== "boolean"
      )
        throw new Error("persisted physics control is invalid");
    } else {
      throw new Error(`unknown persisted game entity kind ${entity.kind}`);
    }
  }
  for (const signal of value.delayedSignals) {
    if (!record(signal)) throw new Error("persisted delayed signal is invalid");
    exact(signal, ["target", "dueTick"]);
    if (
      typeof signal.target !== "string" ||
      signal.target.length === 0 ||
      !tick(signal.dueTick)
    )
      throw new Error("persisted delayed signal is invalid");
  }
}

function exact(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("persisted game state has unknown fields");
}

function tick(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
import type { Vec3 } from "@harrhy/gurgur-engine";
