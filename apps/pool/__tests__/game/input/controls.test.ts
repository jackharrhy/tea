import { expect, test } from "bun:test";
import { createMatch } from "@tea/pool";
import type { TableState } from "@tea/pool-protocol";
import type { HallView } from "../../../app/game/scene/world";
import { Controls } from "../../../app/game/input/controls";
import { CueDrag } from "../../../app/game/input/cue-drag";
import { INPUT_DT, type PlayerState } from "@tea/pool-protocol";
import {
  addAvatar,
  createMovementWorld,
  stepAvatar,
  tableApproach,
  walkable,
  WALK_SPEED,
} from "@tea/pool-simulation";
import { TABLES, tableSeatPosition } from "@tea/pool-simulation/geometry";

function InputElement() {}
function ButtonElement() {}
function Element() {}

test("turn changes cancel a charge before capture loss can reenter, and disconnect clears walking", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { getElementById: () => ({ querySelector: () => ({ style: {} }) }) },
  });
  try {
    const table: TableState = {
      id: "1",
      balls: [],
      rack: 0,
      rematchReady: [],
      match: {
        ...createMatch(),
        players: ["self", "other"],
        phase: "aiming",
        shotNumber: 3,
      },
    };
    const captured = new Set([10, 20]);
    const released: number[] = [];
    let controls: Controls;
    const canvas = {
      hasPointerCapture: (id: number) => captured.has(id),
      releasePointerCapture: (id: number) => {
        captured.delete(id);
        released.push(id);
        if (id === 10) {
          expect(controls.shotDrag).toBeNull();
          expect(controls.keyCharge).toBeNull();
          expect(controls.power).toBe(0);
          controls.cancelShot();
        } else expect(controls.movePointer).toBeNull();
      },
    } as unknown as HTMLCanvasElement;
    const cursor = { visible: true };
    controls = new Controls(
      canvas,
      { cursor } as unknown as HallView,
      {
        closeMenu: () => false,
        closeChat: () => {},
        openChat: () => {},
      },
      {
        read: () => ({
          id: "self",
          own: undefined,
          table,
          entered: true,
          connected: true,
          focusTable: "1",
          shotBlocked: false,
        }),
        position: () => ({ x: 0, z: 0 }),
        focus: () => {},
        changed: () => {},
        joinNearby: () => {},
        approach: () => ({ x: 0, z: 0 }),
        arrive: () => {},
        shoot: () => {
          throw new Error("Cancellation must not shoot");
        },
        send: () => true,
      },
    );
    controls.shotDrag = {
      id: 10,
      gesture: new CueDrag(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { table: "1", turn: 3, angle: 0 },
        100,
      ),
    };
    controls.power = 0.8;
    controls.validateCharge();
    expect(released).toEqual([]);
    table.match.shotNumber++;
    controls.validateCharge();
    expect(released).toEqual([10]);
    controls.keyCharge = { table: "1", turn: 4, angle: 0, at: 0 };
    controls.movePointer = { id: 20, x: 2, y: 2 };
    controls.target = { x: 2, z: 2 };
    controls.route = [{ x: 1, z: 1 }];
    controls.arrivalTable = "1";
    controls.keys.add("w");
    controls.stickInput.x = 1;
    controls.disconnected();
    expect(released).toEqual([10, 20]);
    expect(controls.keyCharge).toBeNull();
    expect(controls.target).toBeNull();
    expect(controls.route).toEqual([]);
    expect(controls.arrivalTable).toBeNull();
    expect(controls.keys.size).toBe(0);
    expect(controls.stickInput).toEqual({ x: 0, z: 0 });
    expect(cursor.visible).toBe(false);
  } finally {
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("table clicks walk to the requested seat, wait for authority, and allow manual cancellation", () => {
  const globals = [
    "document",
    "window",
    "HTMLInputElement",
    "HTMLButtonElement",
    "HTMLElement",
  ] as const;
  const originals = globals.map((name) =>
    Object.getOwnPropertyDescriptor(globalThis, name),
  );
  const windowTarget = new EventTarget();
  const stick = Object.assign(new EventTarget(), {
    querySelector: () => ({ style: {} }),
  });
  const replacements = [
    { activeElement: null, getElementById: () => stick },
    windowTarget,
    InputElement,
    ButtonElement,
    Element,
  ];
  globals.forEach((name, i) =>
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: replacements[i],
    }),
  );
  try {
    const table = TABLES[0];
    const goal = tableSeatPosition(table.id, 0);
    const start = tableSeatPosition(table.id, 1);
    const world = createMovementWorld();
    const avatar = addAvatar(world, start.x, start.z);
    let position = start;
    const own: PlayerState = {
      id: "self",
      name: "Self",
      ...start,
      yaw: 0,
      color: 0,
      table: null,
      connected: true,
      seq: 0,
      revision: 0,
      retiredSeq: 0,
    };
    const arrivals: string[] = [];
    const approaches: string[] = [];
    const cursor = { visible: false, position: { set: () => {} } };
    const actions = {
      read: () => ({
        id: "self",
        own,
        table: undefined,
        entered: true,
        connected: true,
        focusTable: null,
        shotBlocked: false,
      }),
      position: () => position,
      focus: () => {},
      changed: () => {},
      joinNearby: () => {},
      approach: (id: string) => {
        approaches.push(id);
        return goal;
      },
      arrive: (id: string) => {
        arrivals.push(id);
      },
      shoot: () => {},
      send: () => true,
    };
    const view = {
      cursor,
      hitSeat: () => null,
      hit: () => table,
      movement: (x: number, z: number) => ({ x, z }),
    } as unknown as HallView;
    const ui = {
      closeMenu: () => false,
      closeChat: () => {},
      openChat: () => {},
    };
    const controls = new Controls(
      new EventTarget() as HTMLCanvasElement,
      view,
      ui,
      actions,
    );
    controls.bind();
    controls.walkAt(10, 10);
    expect(approaches).toEqual([table.id]);
    expect(controls.target!.x).toBeCloseTo(goal.x, 12);
    expect(controls.target!.z).toBeCloseTo(goal.z, 12);
    expect(controls.route.length).toBeGreaterThan(1);
    expect(position).toEqual(start);
    for (let tick = 0; tick < 500 && controls.route.length; tick++) {
      const direction = controls.direction();
      const next = stepAvatar(
        world,
        avatar,
        direction.x,
        direction.z,
        INPUT_DT,
      );
      expect(walkable(next.x, next.z)).toBe(true);
      expect(
        Math.hypot(next.x - position.x, next.z - position.z),
      ).toBeLessThanOrEqual(WALK_SPEED * INPUT_DT + 1e-9);
      position = next;
    }
    expect(controls.route).toEqual([]);
    expect(Math.hypot(position.x - goal.x, position.z - goal.z)).toBeLessThan(
      0.02,
    );
    expect(arrivals).toEqual([]);
    own.x = position.x;
    own.z = position.z;
    controls.direction();
    controls.direction();
    expect(arrivals).toEqual([table.id]);
    expect(controls.target).toBeNull();

    controls.walkAt(10, 10);
    const keydown = Object.assign(new Event("keydown"), { key: "w" });
    windowTarget.dispatchEvent(keydown);
    expect(controls.target).toBeNull();
    expect(controls.arrivalTable).toBeNull();
    expect(controls.direction()).toEqual({ x: 0, z: -1 });
    expect(arrivals).toEqual([table.id]);

    const withoutApproach = { ...actions, approach: undefined };
    const fallback = new Controls(
      new EventTarget() as HTMLCanvasElement,
      view,
      ui,
      withoutApproach,
    );
    fallback.walkAt(10, 10);
    expect(fallback.target).toEqual(tableApproach(table.id, position));
  } finally {
    globals.forEach((name, i) => {
      if (originals[i]) Object.defineProperty(globalThis, name, originals[i]!);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
