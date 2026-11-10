import { expect, test } from "bun:test";
import { RETRO_COLOR_INTERVALS, bayer4Index } from "../../web/src/retro-color";

test("retro color resolve uses RGB565 intervals and a balanced 4x4 Bayer matrix", () => {
  expect(RETRO_COLOR_INTERVALS).toEqual([31, 63, 31]);
  expect(
    Array.from({ length: 4 }, (_row, y) =>
      Array.from({ length: 4 }, (_column, x) => bayer4Index(x, y)),
    ),
  ).toEqual([
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ]);
});
