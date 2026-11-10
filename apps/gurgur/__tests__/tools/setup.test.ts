import { describe, expect, test } from "bun:test";
import {
  trenchBroomUserDataPath,
  withGurgurGamePath,
} from "../../scripts/setup-trenchbroom";

describe("TrenchBroom setup", () => {
  test("resolves the documented user game configuration directory on each OS", () => {
    expect(trenchBroomUserDataPath("darwin", "/Users/test", {})).toBe(
      "/Users/test/Library/Application Support/TrenchBroom",
    );
    expect(trenchBroomUserDataPath("linux", "/home/test", {})).toBe(
      "/home/test/.TrenchBroom",
    );
    expect(
      trenchBroomUserDataPath("win32", "C:\\Users\\test", {
        APPDATA: "D:\\AppData",
      }),
    ).toBe("D:\\AppData\\TrenchBroom");
  });

  test("preserves preferences while configuring the content directory as the game path", () => {
    const result = JSON.parse(
      withGurgurGamePath('{"Views/Map view layout":3}', "/repo/content"),
    ) as Record<string, unknown>;
    expect(result).toEqual({
      "Views/Map view layout": 3,
      "Games/Gurgur/Path": "/repo/content",
    });
  });
});
