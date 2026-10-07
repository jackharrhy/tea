import { describe, expect, it } from "vitest";
import { writeMapFile, type MapFileHandle } from "../editor-files.ts";
import { mapSourceFingerprint } from "@tea/maps-editor/core";

function testHandle(initial: string) {
  let content = initial;
  let writes = 0;
  const handle: MapFileHandle = {
    name: "test.map",
    async getFile() {
      return new File([content], "test.map", { type: "text/plain" });
    },
    async createWritable() {
      writes += 1;
      return {
        async write(data: Blob | string) {
          content = typeof data === "string" ? data : await data.text();
        },
        async close() {},
      };
    },
  };
  return {
    handle,
    get content() {
      return content;
    },
    get writes() {
      return writes;
    },
    changeExternally(value: string) {
      content = value;
    },
  };
}

describe("map file saving", () => {
  it("writes a file that still matches the opened source", async () => {
    const file = testHandle("original");
    const fingerprint = await writeMapFile(
      file.handle,
      "edited",
      mapSourceFingerprint("original"),
    );
    expect(file.content).toBe("edited");
    expect(fingerprint).toBe(mapSourceFingerprint("edited"));
    expect(file.writes).toBe(1);
  });

  it("blocks saving when the file changed externally", async () => {
    const file = testHandle("original");
    file.changeExternally("someone else's edit");
    await expect(
      writeMapFile(file.handle, "edited", mapSourceFingerprint("original")),
    ).rejects.toThrow("changed on disk");
    expect(file.content).toBe("someone else's edit");
    expect(file.writes).toBe(0);
  });
});
