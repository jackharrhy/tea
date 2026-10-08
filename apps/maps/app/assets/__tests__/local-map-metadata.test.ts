import { describe, expect, it } from "vitest";
import { localMapMetadata } from "../local-map-metadata.ts";

function localFile(path: string, contents = ""): File {
  const file = new File([contents], path.split("/").at(-1)!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("local map sidecars", () => {
  it("prefers Tea metadata and walkability beside a BSP", async () => {
    const bsp = localFile("valve/maps/room.bsp");
    const tea = localFile(
      "valve/maps/room.tea-maps.json",
      JSON.stringify({ label: "Tea room" }),
    );
    const worldview = localFile(
      "valve/maps/room.worldview.json",
      JSON.stringify({ label: "Worldview room" }),
    );
    const teaWalkability = localFile(
      "valve/maps/room.tea-maps-walkability.json",
    );
    const worldviewWalkability = localFile(
      "valve/maps/room.worldview-walkability.json",
    );
    expect(
      await localMapMetadata(
        [bsp, worldview, worldviewWalkability, tea, teaWalkability],
        bsp,
      ),
    ).toEqual({ label: "Tea room", walkability: teaWalkability });
  });

  it("uses the matching Tea label, camera, and walkability graph", async () => {
    const bsp = localFile("valve/maps/room.bsp");
    const metadata = localFile(
      "valve/maps/room.tea-maps.json",
      JSON.stringify({
        label: "  Starting room  ",
        camera: {
          position: [1, 2, 3],
          yawDegrees: 90,
          pitchDegrees: -45,
          fieldOfView: 80,
        },
      }),
    );
    const walkability = localFile("valve/maps/room.tea-maps-walkability.json");

    expect(await localMapMetadata([bsp, metadata, walkability], bsp)).toEqual({
      label: "Starting room",
      camera: {
        position: [1, 2, 3],
        yaw: Math.PI / 2,
        pitch: -Math.PI / 4,
        fieldOfView: 80,
      },
      walkability,
    });
  });

  it("rejects malformed camera metadata for the selected map", async () => {
    const bsp = localFile("valve/maps/room.bsp");
    const metadata = localFile(
      "valve/maps/room.tea-maps.json",
      JSON.stringify({ camera: { position: [0, "bad", 0] } }),
    );

    await expect(localMapMetadata([bsp, metadata], bsp)).rejects.toThrow(
      "camera.position must contain three finite numbers",
    );
  });
});
