import { expect, test } from "bun:test";
import { validateInput } from "../../server/input-validation";
import { MAX_INPUT_MSEC } from "@tea/burger-core";

const VALID = {
  type: "input",
  seq: 1,
  msec: 16,
  up: true,
  down: false,
  left: false,
  right: false,
  interact: false,
};

test("valid input passes and returns trusted shape", () => {
  expect(validateInput(VALID, 0)).toEqual({
    seq: 1,
    msec: 16,
    up: true,
    down: false,
    left: false,
    right: false,
    interact: false,
  });
});

test("rejects non-object input", () => {
  expect(validateInput(null, -1)).toBeNull();
  expect(validateInput(undefined, -1)).toBeNull();
  expect(validateInput("hi", -1)).toBeNull();
  expect(validateInput(42, -1)).toBeNull();
  expect(validateInput(true, -1)).toBeNull();
});

test("rejects wrong type tag", () => {
  expect(validateInput({ ...VALID, type: "signal" }, -1)).toBeNull();
  expect(validateInput({ ...VALID, type: undefined }, -1)).toBeNull();
  const { type: _, ...withoutType } = VALID;
  expect(validateInput(withoutType, -1)).toBeNull();
});

test("rejects missing or non-integer seq", () => {
  expect(validateInput({ ...VALID, seq: undefined }, -1)).toBeNull();
  expect(validateInput({ ...VALID, seq: "1" }, -1)).toBeNull();
  expect(validateInput({ ...VALID, seq: 1.5 }, -1)).toBeNull();
  expect(validateInput({ ...VALID, seq: -1 }, -1)).toBeNull();
  expect(validateInput({ ...VALID, seq: NaN }, -1)).toBeNull();
  expect(validateInput({ ...VALID, seq: Infinity }, -1)).toBeNull();
});

test("rejects replayed or stale seq", () => {
  expect(validateInput({ ...VALID, seq: 5 }, 5)).toBeNull();
  expect(validateInput({ ...VALID, seq: 4 }, 5)).toBeNull();
  expect(validateInput({ ...VALID, seq: 0 }, 5)).toBeNull();
});

test("rejects missing, non-finite, or negative msec", () => {
  expect(validateInput({ ...VALID, msec: undefined }, 0)).toBeNull();
  expect(validateInput({ ...VALID, msec: "16" }, 0)).toBeNull();
  expect(validateInput({ ...VALID, msec: NaN }, 0)).toBeNull();
  expect(validateInput({ ...VALID, msec: Infinity }, 0)).toBeNull();
  expect(validateInput({ ...VALID, msec: -1 }, 0)).toBeNull();
});

test("clamps msec to MAX_INPUT_MSEC", () => {
  const out = validateInput({ ...VALID, msec: 1_000_000 }, 0);
  expect(out?.msec).toBe(MAX_INPUT_MSEC);
});

test("preserves msec when within bounds", () => {
  const out = validateInput({ ...VALID, msec: 7 }, 0);
  expect(out?.msec).toBe(7);
});

test("coerces non-boolean directional fields to booleans", () => {
  const out = validateInput(
    {
      ...VALID,
      up: 1,
      down: "x",
      left: null,
      right: 0,
    },
    0,
  );
  expect(out?.up).toBe(true);
  expect(out?.down).toBe(true);
  expect(out?.left).toBe(false);
  expect(out?.right).toBe(false);
});

test("drops unknown fields from the returned shape", () => {
  const out = validateInput({ ...VALID, malicious: "data", __proto__: {} }, 0);
  expect(out).toEqual({
    seq: 1,
    msec: 16,
    up: true,
    down: false,
    left: false,
    right: false,
    interact: false,
  });
});
