import { describe, expect, test } from "bun:test";
import {
  DEV_FOLLOW_DEFAULT_PITCH,
  DEV_FOLLOW_DEFAULT_YAW,
  parseDevFollowCamera,
} from "../../web/src/dev-follow";

describe("development follow-camera URL", () => {
  test("parses a generation-bearing runtime target with explicit view angles", () => {
    expect(
      parseDevFollowCamera(
        new URLSearchParams("follow=2147483649%3A1&yaw=-0.6776&pitch=-1.2"),
      ),
    ).toEqual({
      target: { index: 2_147_483_649, generation: 1 },
      yaw: -0.6776,
      pitch: -1.2,
    });
  });

  test("uses the ordinary third-person view angles when they are omitted", () => {
    expect(parseDevFollowCamera(new URLSearchParams("follow=7%3A2"))).toEqual({
      target: { index: 7, generation: 2 },
      yaw: DEV_FOLLOW_DEFAULT_YAW,
      pitch: DEV_FOLLOW_DEFAULT_PITCH,
    });
  });

  test.each([
    "follow=7",
    "follow=-1%3A2",
    "follow=7%3A2.5",
    "follow=4294967296%3A1",
    "follow=7%3A4294967296",
    "follow=7%3A2&yaw=wat",
    "follow=7%3A2&pitch=1.36",
    "follow=7%3A2&pitch=-1.36",
  ])("rejects malformed or unsafe requests: %s", (query) => {
    expect(parseDevFollowCamera(new URLSearchParams(query))).toBeNull();
  });
});
