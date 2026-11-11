import { test } from "node:test";
import assert from "node:assert/strict";
import {
  videoBudget,
  parseCommand,
  supportedVideoBitrate,
  calibratedVideoBitrate,
  encoderRateStalled,
} from "../src/domain.mjs";
test("recognizes an encoder floor without stopping responsive rate control", () => {
  const previous = { bitrate: 600000, size: 20000000 };
  assert.equal(encoderRateStalled(previous, 250000, 19800000), true);
  assert.equal(encoderRateStalled(previous, 250000, 9000000), false);
  assert.ok(!encoderRateStalled(undefined, 250000, 19800000));
});
test("finds a supported rate without throwing away half the available budget", async () => {
  const rate = await supportedVideoBitrate(80000, async (n) => n <= 23000);
  assert.ok(rate <= 23000 && rate > 22700);
  assert.equal(await supportedVideoBitrate(80000, async () => false), null);
});
test("calibrates substantial undershoot while leaving easy and near-budget clips alone", () => {
  assert.equal(calibratedVideoBitrate(3000000, 2000000, 8388608, 300000), null);
  assert.equal(calibratedVideoBitrate(3000000, 8000000, 8388608, 300000), null);
  const rate = calibratedVideoBitrate(2500000, 6478989, 8388608, 384000);
  assert.ok(rate > 3100000 && rate < 3200000);
});
test("reserves audio and overhead before spending video bitrate", () => {
  const b = videoBudget(8, 60, 960000);
  assert.equal(b.bytes, 8388608);
  assert.ok((b.bitrate * 60) / 8 + 960000 < 8 * 1048576);
  assert.throws(() => videoBudget(0.1, 120, 1920000), /audio and clip length/);
});
test("rejects invalid size and trim inputs", () => {
  for (const args of [
    [NaN, 2, 0],
    [8, 0, 0],
    [8, -1, 0],
    [8, 2, -1],
  ])
    assert.throws(() => videoBudget(...args));
});
test("parses quoted filters and injects the selected input once", () => {
  assert.deepEqual(
    parseCommand(
      '-vf "fps=10,scale=320:-1:flags=lanczos" output.gif',
      "/source/input.mov",
    ),
    {
      args: [
        "-i",
        "/source/input.mov",
        "-vf",
        "fps=10,scale=320:-1:flags=lanczos",
        "output.gif",
      ],
      output: "output.gif",
    },
  );
  assert.deepEqual(
    parseCommand("ffmpeg -i input.ext -c copy output.mp4", "/source/input.mov")
      .args,
    ["-i", "/source/input.mov", "-c", "copy", "output.mp4"],
  );
});
test("rejects unfinished quoting and ambiguous output paths", () => {
  assert.throws(() => parseCommand('-vf "fps=10 output.gif', "x"), /quotes/);
  assert.throws(() => parseCommand("-c copy ../output.mp4", "x"), /filename/);
});

test("automatic sizing fits the budget without upscaling or distorting portrait clips", async () => {
  const { automaticDimensions, smallerDimensions, DEFAULT_LIMIT } =
    await import("../src/domain.mjs");
  assert.equal(DEFAULT_LIMIT, 8000000);
  const big = automaticDimensions(4096, 2304, 1183497, 24);
  assert.ok(big.width < 1920 && big.height < 1080);
  assert.equal(big.width % 2, 0);
  assert.equal(big.height % 2, 0);
  assert.ok(Math.abs(big.width / big.height - 16 / 9) < 0.01);
  const portrait = automaticDimensions(1080, 1920, 600000, 30);
  assert.ok(Math.abs(portrait.width / portrait.height - 9 / 16) < 0.01);
  assert.deepEqual(automaticDimensions(320, 180, 3000000, 30), {
    width: 320,
    height: 180,
  });
  let size = big;
  for (let i = 0; i < 30 && size; i++) {
    const next = smallerDimensions(size.width, size.height);
    if (next) assert.ok(next.width < size.width && next.height < size.height);
    size = next;
  }
  assert.equal(size, null);
});
