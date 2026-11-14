import { test, expect } from "vitest";
import { chatStyle } from "../app/chat-style.ts";

test("the five-minute badge matches Python Random(int).choice reference vectors", () => {
  expect(chatStyle(0)).toMatchObject({
    fontFamily: "serif",
    color: "#ff6600",
    background: "#000",
    border: "3px double #66ff33",
  });
  expect(chatStyle(300_000)).toMatchObject({
    fontFamily: "cursive",
    color: "#00ff00",
    background: "#220022",
    border: "3px solid #66ff33",
  });
  expect(chatStyle(5981140 * 300_000)).toMatchObject({
    fontFamily: "Comic Sans MS, cursive",
    color: "#ff0000",
    background: "#111",
    border: "3px double #ff00ff",
  });
  expect(chatStyle(299_999)).toEqual(chatStyle(0));
});
