import { expect, it } from "vitest";
import { configuredCompilerEndpoints } from "../src/server.js";

it("uses Tea compiler endpoints without inheriting Worldview destinations", () => {
  expect(
    configuredCompilerEndpoints({
      WORLDVIEW_QUAKE_COMPILER_URL: "https://original.example/compile",
      TEA_MAPS_QUAKE_COMPILER_URL: "http://127.0.0.1:8788",
      TEA_MAPS_GOLDSRC_COMPILER_URL: "http://127.0.0.1:8789",
    }),
  ).toEqual({
    quake: "http://127.0.0.1:8788",
    goldsrc: "http://127.0.0.1:8789",
  });
  expect(
    configuredCompilerEndpoints({
      WORLDVIEW_QUAKE_COMPILER_URL: "https://original.example/compile",
    }),
  ).toEqual({});
});
