import {
  PHYSICS_HZ,
  PROTOCOL_VERSION,
  type InputCommand,
} from "@tea/gurgur-engine";

const MOVEMENT_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "Space",
  "KeyE",
  "ControlLeft",
  "ControlRight",
]);
const noOp = (): void => {};
const deadzone = (value: number): number =>
  Math.abs(value) < 0.16 ? 0 : value;

type TouchState = { id: number; x: number; y: number };

export type PlayerInput = {
  readonly yaw: number;
  readonly pitch: number;
  setTextEntryActive(active: boolean): void;
  requestPointerLock(): void;
  setWorld(worldEpoch: number, yaw?: number): void;
  dispose(): void;
};

export function createPlayerInput(
  canvas: HTMLCanvasElement,
  send: (command: InputCommand) => void,
  onLook: (yaw: number, pitch: number) => void,
  interactionTarget: () => InputCommand["interactTarget"] = () => null,
): PlayerInput {
  const keys = new Set<string>();
  let worldEpoch: number | null = null;
  let sequence = 0;
  let clientTick = 0;
  let yaw = 0;
  let pitch = -0.18;
  let jumpCounter = 0;
  let interactCounter = 0;
  let primaryCounter = 0;
  let gamepadJump = false;
  let gamepadInteract = false;
  let gamepadPrimary = false;
  let gamepadCrouch = false;
  let moveTouch: (TouchState & { startX: number; startY: number }) | null =
    null;
  let lookTouch: TouchState | null = null;
  let textEntryActive = false;
  let flush = noOp;

  const clearKeys = (): void => keys.clear();
  const focusCanvas = (): void => {
    canvas.focus({ preventScroll: true });
  };
  const pointerLockChanged = (): void => {
    const locked = document.pointerLockElement === canvas;
    document.body.dataset.pointerLocked = String(locked);
    if (locked) focusCanvas();
  };
  const pointerLockFailed = (): void => {
    document.body.dataset.pointerLocked = "false";
    document.body.dataset.pointerLockFailed = "true";
    focusCanvas();
  };
  const lockPointer = (): void => {
    focusCanvas();
    if (document.pointerLockElement === canvas) return;
    try {
      const result = canvas.requestPointerLock() as Promise<void> | undefined;
      if (result && typeof result.catch === "function")
        void result.catch(pointerLockFailed);
    } catch {
      pointerLockFailed();
    }
  };
  const keyDown = (event: KeyboardEvent): void => {
    if (textEntryActive) return;
    if (MOVEMENT_KEYS.has(event.code)) event.preventDefault();
    if (!event.repeat && event.code === "Space") jumpCounter += 1;
    if (!event.repeat && event.code === "KeyE") interactCounter += 1;
    keys.add(event.code);
  };
  const keyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code);
  };
  const visibilityChanged = (): void => {
    if (document.hidden) clearKeys();
  };
  const mouseMove = (event: MouseEvent): void => {
    if (textEntryActive) return;
    if (document.pointerLockElement !== canvas) return;
    yaw -= event.movementX * 0.0022;
    pitch = Math.max(-1.35, Math.min(1.35, pitch - event.movementY * 0.0022));
    onLook(yaw, pitch);
    flush();
  };
  const mouseDown = (event: MouseEvent): void => {
    if (textEntryActive) return;
    if (event.button !== 0) return;
    if (document.pointerLockElement === canvas) primaryCounter += 1;
    else if (event.target === canvas) lockPointer();
  };
  const pointerDown = (event: PointerEvent): void => {
    if (textEntryActive) return;
    if (event.pointerType !== "touch") return;
    event.preventDefault();
    focusCanvas();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic and cancelled pointers may not be capturable.
    }
    if (event.clientX < innerWidth / 2 && !moveTouch) {
      moveTouch = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
      };
    } else if (!lookTouch) {
      lookTouch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  };
  const pointerMove = (event: PointerEvent): void => {
    if (textEntryActive) return;
    if (moveTouch?.id === event.pointerId) {
      moveTouch.x = event.clientX;
      moveTouch.y = event.clientY;
    } else if (lookTouch?.id === event.pointerId) {
      const dx = event.clientX - lookTouch.x;
      const dy = event.clientY - lookTouch.y;
      lookTouch.x = event.clientX;
      lookTouch.y = event.clientY;
      yaw -= dx * 0.006;
      pitch = Math.max(-1.35, Math.min(1.35, pitch - dy * 0.006));
      onLook(yaw, pitch);
      flush();
    }
  };
  const pointerUp = (event: PointerEvent): void => {
    if (moveTouch?.id === event.pointerId) moveTouch = null;
    if (lookTouch?.id === event.pointerId) lookTouch = null;
  };
  const pollGamepad = (): { x: number; z: number } => {
    if (textEntryActive) return { x: 0, z: 0 };
    const gamepad =
      navigator.getGamepads?.().find((candidate) => candidate?.connected) ??
      null;
    if (!gamepad) return { x: 0, z: 0 };
    const jump = Boolean(gamepad.buttons[0]?.pressed);
    const interact = Boolean(gamepad.buttons[2]?.pressed);
    const primary = Boolean(gamepad.buttons[7]?.pressed);
    if (jump && !gamepadJump) jumpCounter += 1;
    if (interact && !gamepadInteract) interactCounter += 1;
    if (primary && !gamepadPrimary) primaryCounter += 1;
    gamepadJump = jump;
    gamepadInteract = interact;
    gamepadPrimary = primary;
    gamepadCrouch = Boolean(gamepad.buttons[1]?.pressed);
    return {
      x: deadzone(gamepad.axes[0] ?? 0),
      z: -deadzone(gamepad.axes[1] ?? 0),
    };
  };
  flush = (): void => {
    if (worldEpoch === null || document.hidden) return;
    const gamepad = pollGamepad();
    const touchX = moveTouch
      ? Math.max(-1, Math.min(1, (moveTouch.x - moveTouch.startX) / 55))
      : 0;
    const touchZ = moveTouch
      ? Math.max(-1, Math.min(1, (moveTouch.startY - moveTouch.y) / 55))
      : 0;
    const moveX = Math.max(
      -1,
      Math.min(
        1,
        Number(keys.has("KeyD")) -
          Number(keys.has("KeyA")) +
          gamepad.x +
          touchX,
      ),
    );
    const moveZ = Math.max(
      -1,
      Math.min(
        1,
        Number(keys.has("KeyW")) -
          Number(keys.has("KeyS")) +
          gamepad.z +
          touchZ,
      ),
    );
    send({
      type: "input",
      protocolVersion: PROTOCOL_VERSION,
      worldEpoch,
      sequence: sequence++,
      clientTick: clientTick++,
      moveX,
      moveZ,
      lookYaw: yaw,
      lookPitch: pitch,
      buttons: textEntryActive
        ? 0
        : Number(keys.has("Space")) |
          (Number(keys.has("KeyE")) << 1) |
          (Number(
            keys.has("ControlLeft") ||
              keys.has("ControlRight") ||
              gamepadCrouch,
          ) <<
            2),
      jumpCounter,
      interactCounter,
      interactTarget: textEntryActive ? null : interactionTarget(),
      primaryCounter,
    });
  };

  document.body.dataset.pointerLocked = "false";
  addEventListener("keydown", keyDown);
  addEventListener("keyup", keyUp);
  addEventListener("blur", clearKeys);
  addEventListener("mousemove", mouseMove);
  addEventListener("mousedown", mouseDown);
  document.addEventListener("pointerlockchange", pointerLockChanged);
  document.addEventListener("pointerlockerror", pointerLockFailed);
  document.addEventListener("visibilitychange", visibilityChanged);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  const timer = window.setInterval(flush, 1_000 / PHYSICS_HZ);

  return {
    get yaw() {
      return yaw;
    },
    get pitch() {
      return pitch;
    },
    setTextEntryActive(active) {
      textEntryActive = active;
      if (active) {
        clearKeys();
        moveTouch = null;
        lookTouch = null;
        gamepadJump = false;
        gamepadInteract = false;
        gamepadPrimary = false;
        gamepadCrouch = false;
      }
    },
    requestPointerLock: lockPointer,
    setWorld(nextWorldEpoch, nextYaw) {
      if (worldEpoch === nextWorldEpoch) return;
      worldEpoch = nextWorldEpoch;
      sequence = 0;
      clientTick = 0;
      if (nextYaw !== undefined) yaw = nextYaw;
    },
    dispose() {
      clearInterval(timer);
      removeEventListener("keydown", keyDown);
      removeEventListener("keyup", keyUp);
      removeEventListener("blur", clearKeys);
      removeEventListener("mousemove", mouseMove);
      removeEventListener("mousedown", mouseDown);
      document.removeEventListener("pointerlockchange", pointerLockChanged);
      document.removeEventListener("pointerlockerror", pointerLockFailed);
      document.removeEventListener("visibilitychange", visibilityChanged);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
    },
  };
}
