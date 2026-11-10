import { expect, test } from "bun:test";
import { webGPUAvailable } from "../../web/src/webgpu-support";

test("requires a successfully acquired WebGPU adapter before loading the client", async () => {
  expect(await webGPUAvailable(undefined)).toBeFalse();
  expect(
    await webGPUAvailable({ requestAdapter: async () => null }),
  ).toBeFalse();
  expect(
    await webGPUAvailable({
      requestAdapter: async () => ({ name: "fixture" }),
    }),
  ).toBeTrue();
  expect(
    await webGPUAvailable({
      requestAdapter: async () => {
        throw new Error("adapter denied");
      },
    }),
  ).toBeFalse();
});
