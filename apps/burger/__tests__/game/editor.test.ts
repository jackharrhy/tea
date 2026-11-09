import { expect, test, describe } from "bun:test";
import { canEnterPaintMode, canPaintCell } from "../../app/game/editor";

type FakeUser = { isAdmin: boolean };

describe("canEnterPaintMode", () => {
  test("admin always allowed", () => {
    const user: FakeUser = { isAdmin: true };
    expect(canEnterPaintMode(user, new Set())).toBe(true);
    expect(canEnterPaintMode(user, new Set(["16,16"]))).toBe(true);
  });

  test("non-admin with empty zone cells rejected", () => {
    const user: FakeUser = { isAdmin: false };
    expect(canEnterPaintMode(user, new Set())).toBe(false);
  });

  test("non-admin with non-empty zone cells allowed", () => {
    const user: FakeUser = { isAdmin: false };
    expect(canEnterPaintMode(user, new Set(["16,16"]))).toBe(true);
  });
});

describe("canPaintCell", () => {
  test("admin always allowed", () => {
    const user: FakeUser = { isAdmin: true };
    expect(canPaintCell(user, new Set(), "16,16")).toBe(true);
  });

  test("non-admin allowed iff key in set", () => {
    const user: FakeUser = { isAdmin: false };
    const cells = new Set(["16,16", "48,16"]);
    expect(canPaintCell(user, cells, "16,16")).toBe(true);
    expect(canPaintCell(user, cells, "80,16")).toBe(false);
  });
});
