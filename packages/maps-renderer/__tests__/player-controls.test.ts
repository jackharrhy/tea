import { describe, expect, it } from "vitest";

import { parseBsp } from "../src/core/index.js";

import { WorldCamera } from "../src/viewer/camera.js";
import {
  WorldControls,
  type PlayerSoundEvent,
} from "../src/viewer/controls.js";
import { makeBsp } from "./fixtures.js";

describe("player controls", () => {
  it("defaults to walking, emits surface-sound cues, and toggles noclip with V", () => {
    const listeners = new Map<string, EventListener[]>();
    const canvas = {
      tabIndex: 0,
      getAttribute: () => null,
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (typeof listener !== "function") return;
        const registered = listeners.get(type) ?? [];
        registered.push(listener);
        listeners.set(type, registered);
      },
      removeEventListener: () => undefined,
    } as unknown as HTMLCanvasElement;
    const dispatchKey = (code: string) => {
      const event = {
        code,
        repeat: false,
        preventDefault: () => undefined,
      } as KeyboardEvent;
      for (const listener of listeners.get("keydown") ?? []) listener(event);
    };
    const world = parseBsp(makeBsp({ collision: true }));
    const camera = new WorldCamera();
    camera.update({ position: [8, 8, 64.031_25] });
    const sounds: PlayerSoundEvent[] = [];
    const modes: string[] = [];
    const controls = new WorldControls(
      canvas,
      "walk",
      () => undefined,
      (mode) => modes.push(mode),
      (event) => sounds.push(event),
    );
    expect(controls.setWorld(world, camera)).toBe(false);
    expect(controls.mode).toBe("walk");

    dispatchKey("KeyW");
    for (let command = 0; command < 80; command += 1)
      controls.update(camera, 0.01);
    expect(sounds.some((sound) => sound.kind === "step")).toBe(true);

    dispatchKey("Space");
    controls.update(camera, 0.01);
    expect(sounds.some((sound) => sound.kind === "jump")).toBe(true);

    dispatchKey("KeyV");
    controls.update(camera, 0.01);
    expect(controls.mode).toBe("fly");
    dispatchKey("KeyV");
    controls.update(camera, 0.01);
    expect(controls.mode).toBe("walk");
    expect(modes).toEqual(["fly", "walk"]);
    controls.dispose();
  });

  it("uses the Counter-Strike player speed cap for maps with CS entities", () => {
    const canvas = {
      tabIndex: 0,
      getAttribute: () => null,
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as HTMLCanvasElement;
    const world = parseBsp(
      makeBsp({
        collision: true,
        entityText:
          '{ "classname" "worldspawn" }\n{ "classname" "func_buyzone" "model" "*1" }',
      }),
    );
    const camera = new WorldCamera();
    camera.update({ position: [8, 8, 64.031_25] });
    const controls = new WorldControls(
      canvas,
      "walk",
      () => undefined,
      () => undefined,
      () => undefined,
    );
    controls.setWorld(world, camera);
    expect(controls.settings.maxSpeed).toBe(250);
    controls.setSettings({ maxSpeed: 275, friction: 6 });
    expect(controls.settings).toMatchObject({ maxSpeed: 275, friction: 6 });
    controls.dispose();
  });

  it("applies GoldSrc sensitivity and custom mouse acceleration to pointer input", () => {
    const listeners = new Map<string, EventListener>();
    const root = { pointerLockElement: null as HTMLCanvasElement | null };
    const canvas = {
      tabIndex: 0,
      getRootNode: () => root,
      getAttribute: () => null,
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (typeof listener === "function") listeners.set(type, listener);
      },
      removeEventListener: () => undefined,
    } as unknown as HTMLCanvasElement;
    let look: { yaw: number; pitch: number } | undefined;
    const controls = new WorldControls(
      canvas,
      "walk",
      (nextLook) => {
        look = nextLook;
      },
      () => undefined,
      () => undefined,
      { mouseSensitivity: 3, mouseAcceleration: 0.04 },
    );
    root.pointerLockElement = canvas;
    listeners.get("mousemove")?.({
      movementX: 10,
      movementY: -5,
    } as unknown as MouseEvent);
    const sensitivity = 3 + Math.hypot(10, -5) * 0.04;
    const radiansPerCount = (0.022 * sensitivity * Math.PI) / 180;
    expect(look?.yaw).toBeCloseTo(-10 * radiansPerCount);
    expect(look?.pitch).toBeCloseTo(5 * radiansPerCount);
    controls.dispose();
  });
});
