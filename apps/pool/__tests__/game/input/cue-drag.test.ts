import { describe, expect, test } from "bun:test";
import { CueDrag } from "../../../app/game/input/cue-drag";

const shot = { table: "table-1", turn: 7, angle: 1.2 };

describe("cue pullback", () => {
  test("normalizes projected direction and ignores the sideways component", () => {
    const drag = new CueDrag({ x: 100, y: 200 }, { x: 3, y: 4 }, shot, 100);
    const point = { x: 54, y: 172 };
    expect(drag.update(point)).toBeCloseTo(0.5);
    expect(drag.release(point)).toEqual({ ...shot, power: 0.5 });
  });

  test("requires 6px backward pull before applying the minimum power", () => {
    const drag = new CueDrag({ x: 0, y: 0 }, { x: 1, y: 0 }, shot, 200);
    expect(drag.update({ x: -5.99, y: 100 })).toBe(0);
    expect(drag.release({ x: -5.99, y: 100 })).toBeNull();
    expect(drag.update({ x: -6, y: 0 })).toBe(0.05);
    expect(drag.release({ x: -6, y: 0 })).toEqual({ ...shot, power: 0.05 });
    expect(drag.update({ x: -18, y: 0 })).toBe(0.1);
  });

  test("clamps maximum power and cancels on sideways, forward, or origin release", () => {
    const drag = new CueDrag({ x: 10, y: 20 }, { x: 1, y: 0 }, shot, 100);
    expect(drag.release({ x: -190, y: 20 })).toEqual({ ...shot, power: 1 });
    for (const point of [
      { x: 10, y: 300 },
      { x: 40, y: 20 },
      { x: 10, y: 20 },
    ]) {
      expect(drag.update({ x: -190, y: 20 })).toBe(1);
      expect(drag.update(point)).toBe(0);
      expect(drag.release(point)).toBeNull();
    }
  });

  test("freezes start, aim, and shot token against caller mutations", () => {
    const start = { x: 10, y: 20 };
    const direction = { x: 0, y: -2 };
    const token = { ...shot };
    const drag = new CueDrag(start, direction, token, 100);
    start.y = 500;
    direction.x = 1;
    direction.y = 0;
    token.table = "table-2";
    token.turn = 8;
    token.angle = 0;
    expect(drag.shot).toEqual(shot);
    expect(drag.shot).not.toBe(token);
    expect(Object.isFrozen(drag.shot)).toBe(true);
    expect(Reflect.set(drag.shot, "turn", 99)).toBe(false);
    expect(drag.release({ x: 10, y: 70 })).toEqual({ ...shot, power: 0.5 });
  });

  test.each([
    [60, 90],
    [120, 120],
    [240, 180],
  ])("clamps supplied pull length %ipx to %ipx", (length, clamped) => {
    const drag = new CueDrag({ x: 0, y: 0 }, { x: -1, y: 0 }, shot, length);
    expect(drag.update({ x: 60, y: 0 })).toBe(60 / clamped);
    expect(drag.update({ x: clamped, y: 0 })).toBe(1);
  });

  test("rejects undefined direction and invalid pull lengths", () => {
    expect(
      () => new CueDrag({ x: 0, y: 0 }, { x: 0, y: 0 }, shot, 100),
    ).toThrow(RangeError);
    for (const length of [0, -1, Infinity, NaN]) {
      expect(
        () => new CueDrag({ x: 0, y: 0 }, { x: 1, y: 0 }, shot, length),
      ).toThrow(RangeError);
    }
  });
});
