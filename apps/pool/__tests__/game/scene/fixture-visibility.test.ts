import { expect, test } from "bun:test";
import { Box3, Vector3 } from "three";
import { fixtureOpacity } from "../../../app/game/scene/fixture-visibility";

const shade = (x: number, y: number, z: number) =>
  new Box3(
    new Vector3(x - 0.3, y - 0.11, z - 0.3),
    new Vector3(x + 0.3, y + 0.11, z + 0.3),
  );
const table = { x: 0, z: 0 };

test("a pendant fades independently while its neighbour remains clear", () => {
  const camera = new Vector3(0, 4, 6);
  const blocked = fixtureOpacity([shade(0, 2.6, 3.4)], camera, table);
  const clear = fixtureOpacity([shade(3, 2.6, 3.4)], camera, table);
  expect(blocked).toBeLessThan(0.5);
  expect(clear).toBe(1);
});

test("approaching the sightline has intermediate opacity and preserves bounds", () => {
  const camera = new Vector3(0, 4, 6);
  const values = Array.from({ length: 61 }, (_, i) =>
    fixtureOpacity([shade(i * 0.025, 2.6, 3.4)], camera, table),
  );
  expect(
    values.filter((v) => v > 0.1 && v < 0.95).length,
  ).toBeGreaterThanOrEqual(8);
  expect(values[0]).toBeLessThan(0.1);
  expect(values.at(-1)).toBe(1);
  for (let i = 1; i < values.length; i++) {
    expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]!);
    expect(values[i]! - values[i - 1]!).toBeLessThan(0.25);
  }
});

test("geometry beyond the table does not obscure it or mutate cached bounds", () => {
  const box = shade(0, 0.3, -5);
  const before = box.clone();
  expect(fixtureOpacity([box], new Vector3(0, 4, 6), table)).toBe(1);
  expect(box.equals(before)).toBe(true);
});
