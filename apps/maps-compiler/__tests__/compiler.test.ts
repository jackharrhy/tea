import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RemoteMapCompiler } from "@tea/maps-editor/core";
import { describe, expect, it } from "vitest";

import {
  compileNativeMap,
  compilerStages,
  parseCompilerGameProfile,
  safeAssetName,
  safeMapName,
} from "../src/compiler.js";
import { configuredLaunchProfile, launchBuild } from "../src/launch.js";
import {
  BoundedBuildHistory,
  helperCapabilities,
  originAllowed,
  parseCompileRequest,
  parseLaunchRequest,
} from "../src/protocol.js";

function successfulBuild(buildId: string, revision: number) {
  return {
    status: "succeeded" as const,
    buildId,
    sourceDocumentRevision: revision,
    diagnostics: [],
    artifacts: [
      {
        name: "test.bsp",
        mediaType: "application/x-quake-bsp",
        base64: "AQID",
        kind: "bsp" as const,
      },
    ],
    logs: [],
    elapsedMilliseconds: 1,
  };
}

describe("native compiler planning", () => {
  it("uses fast vis and bounded light work for preview compiles", () => {
    const stages = compilerStages(
      "preview",
      "/tmp/preview.map",
      "/tmp/preview.bsp",
      {
        maxThreads: 2,
        toolchain: {
          kind: "ericw",
          target: "quake",
          qbsp: "/tools/qbsp",
          vis: "/tools/vis",
          light: "/tools/light",
        },
      },
      "/tmp/assets",
    );

    expect(stages.map((stage) => stage.stage)).toEqual([
      "qbsp",
      "vis",
      "light",
    ]);
    expect(stages[0]?.args).toContain("/tmp/preview.map");
    expect(stages[0]?.args).toContain("-nofill");
    expect(stages[0]?.args).not.toContain("-hlbsp");
    expect(stages[0]?.args).toEqual(
      expect.arrayContaining(["-wadpath", "/tmp/assets"]),
    );
    expect(stages[1]?.args).toContain("-fast");
    expect(stages[2]?.args).toEqual(
      expect.arrayContaining([
        "-threads",
        "2",
        "-gate",
        "1",
        "/tmp/preview.bsp",
      ]),
    );
  });

  it("builds GoldSrc BSP30 with detailed vis and extra light sampling for final compiles", () => {
    const stages = compilerStages("final", "/tmp/final.map", "/tmp/final.bsp", {
      maxThreads: 4,
      gameDirectory: "/srv/cstrike",
      toolchain: {
        kind: "ericw",
        target: "goldsrc",
        qbsp: "/tools/qbsp",
        vis: "/tools/vis",
        light: "/tools/light",
      },
    });

    expect(stages[1]?.args).not.toContain("-fast");
    expect(stages[0]?.args).not.toContain("-nofill");
    expect(stages[2]?.args).toContain("-extra");
    expect(stages.every((stage) => stage.args.includes("/srv/cstrike"))).toBe(
      true,
    );
    expect(stages[0]?.args).toContain("-hlbsp");
    expect(stages[1]?.args).not.toContain("-hlbsp");
    expect(stages[2]?.args).not.toContain("-hlbsp");
  });

  it("plans Quake II as one explicit q2tool pipeline", () => {
    const stages = compilerStages("preview", "/tmp/q2.map", "/tmp/q2.bsp", {
      maxThreads: 3,
      gameDirectory: "/games/quake2",
      toolchain: { kind: "q2tool", executable: "/tools/q2tool" },
    });

    expect(stages).toEqual([
      {
        stage: "q2tool",
        executable: "/tools/q2tool",
        args: [
          "-bsp",
          "-vis",
          "-threads",
          "3",
          "-gamedir",
          "/games/quake2",
          "-fast",
          "/tmp/q2.map",
        ],
      },
    ]);
    expect(
      compilerStages("final", "/tmp/q2.map", "/tmp/q2.bsp", {
        maxThreads: 3,
        toolchain: { kind: "q2tool", executable: "/tools/q2tool" },
      })[0]?.args,
    ).toEqual(expect.arrayContaining(["-rad", "-extra"]));
    expect(
      compilerStages(
        "preview",
        "/tmp/assets/maps/q2.map",
        "/tmp/assets/maps/q2.bsp",
        {
          maxThreads: 3,
          toolchain: { kind: "q2tool", executable: "/tools/q2tool" },
        },
        "/tmp/assets",
      )[0]?.args,
    ).toEqual(expect.arrayContaining(["-gamedir", "/tmp/assets"]));
  });

  it.skipIf(process.platform === "win32")(
    "places requested Quake II textures inside the temporary game tree",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "tea-q2-assets-test-"));
      try {
        const executable = join(directory, "q2tool.cjs");
        await writeFile(
          executable,
          `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const gameDir = args[args.indexOf('-gamedir') + 1];
const texture = fs.readFileSync(path.join(gameDir, 'textures/e1u1/test.wal'));
if (!texture.equals(Buffer.from([1, 2, 3]))) process.exit(3);
const map = args.at(-1);
fs.writeFileSync(map.replace(/\\.map$/, '.bsp'), Buffer.from([38, 0, 0, 0]));
`,
        );
        await chmod(executable, 0o755);
        const result = await compileNativeMap(
          {
            mapName: "room",
            mapText: "{}",
            quality: "preview",
            expectedDocumentRevision: 1,
            assets: [
              {
                name: "textures/e1u1/test.wal",
                mediaType: "application/octet-stream",
                base64: Buffer.from([1, 2, 3]).toString("base64"),
              },
            ],
          },
          {
            toolchain: { kind: "q2tool", executable },
            maxThreads: 1,
            timeoutMilliseconds: 5_000,
            maxLogBytes: 1_024,
            maxArtifactBytes: 1_024,
          },
        );
        expect(result.status).toBe("succeeded");
        expect(result.artifacts).toContainEqual(
          expect.objectContaining({ name: "room.bsp", kind: "bsp" }),
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("rejects mixing q2tool project assets with an external game directory", async () => {
    await expect(
      compileNativeMap(
        {
          mapName: "room",
          mapText: "{}",
          quality: "preview",
          expectedDocumentRevision: 1,
          assets: [
            {
              name: "textures/e1u1/test.wal",
              mediaType: "application/octet-stream",
              base64: "AQID",
            },
          ],
        },
        {
          toolchain: { kind: "q2tool", executable: "/tools/q2tool" },
          gameDirectory: "/games/quake2",
          maxThreads: 1,
          timeoutMilliseconds: 5_000,
          maxLogBytes: 1_024,
          maxArtifactBytes: 1_024,
        },
      ),
    ).rejects.toThrow(/cannot be combined with TEA_MAPS_GAME_DIR/);
  });

  it("bounds each ericw Quake II stage and keeps the game-root paths", () => {
    const stages = compilerStages(
      "final",
      "/tmp/assets/maps/course.map",
      "/tmp/assets/maps/course.bsp",
      {
        maxThreads: 6,
        toolchain: {
          kind: "ericw",
          target: "quake2",
          qbsp: "/tools/qbsp",
          vis: "/tools/vis",
          light: "/tools/light",
        },
      },
      "/tmp/assets",
    );
    expect(stages.map(({ stage }) => stage)).toEqual(["qbsp", "vis", "light"]);
    expect(
      stages.every(({ args }) => args.join(" ").includes("-threads 6")),
    ).toBe(true);
    expect(stages[0]?.args).toEqual(
      expect.arrayContaining(["-q2bsp", "-noallowupgrade", "-leaktest"]),
    );
    expect(stages[2]?.args).toEqual(
      expect.arrayContaining(["-extra4", "-visapprox", "vis"]),
    );
  });

  it("parses configured game profiles without silently downgrading invalid values", () => {
    expect(parseCompilerGameProfile(undefined)).toBe("quake");
    expect(parseCompilerGameProfile("quake2")).toBe("quake2");
    expect(parseCompilerGameProfile("gower")).toBe("gower");
    expect(() => parseCompilerGameProfile("q2")).toThrow(
      /not a supported game/,
    );
  });

  it("rejects names that could escape the isolated compile directory", () => {
    expect(safeMapName("test_map-01")).toBe("test_map-01");
    expect(() => safeMapName("../outside")).toThrow(/mapName/);
    expect(() => safeMapName("name with spaces")).toThrow(/mapName/);
    expect(safeAssetName("textures.wad")).toBe("textures.wad");
    expect(() => safeAssetName("../textures.wad")).toThrow(/Asset names/);
    expect(() => safeAssetName("payload.sh")).toThrow(/unsupported extension/);
  });

  // The synthetic native executable uses a POSIX shebang; protocol unit tests run on every OS.
  it
    .skipIf(process.platform === "win32")
    .each(["succeeded", "failed"] as const)(
    "round-trips a native %s result through the browser protocol",
    async (status) => {
      const directory = await mkdtemp(join(tmpdir(), "maps-native-test-"));
      try {
        const executable = join(directory, "compiler.cjs");
        await writeFile(
          executable,
          `#!${process.execPath}
const fs = require('node:fs');
const path = process.argv.at(-1).replace(/\\.map$/, '');
fs.writeFileSync(path + '.pts', '0 0 0\\n16 0 0\\n');
if (${JSON.stringify(status)} === 'failed') {
  process.stdout.write('ERROR: ' + 'x'.repeat(128));
  process.exitCode = 1;
} else {
  fs.writeFileSync(path + '.bsp', Buffer.from([29, 0, 0, 0]));
  process.stdout.write('compiled');
}
`,
        );
        await chmod(executable, 0o755);
        const compiler = new RemoteMapCompiler({
          endpoint: "http://compiler.invalid/compile",
          fetch: async (_input, init) =>
            Response.json(
              await compileNativeMap(
                parseCompileRequest(JSON.parse(String(init?.body))),
                {
                  toolchain: { kind: "q2tool", executable },
                  maxThreads: 1,
                  timeoutMilliseconds: 5_000,
                  maxLogBytes: 32,
                  maxArtifactBytes: 1_024,
                },
              ),
            ),
        });
        const result = await compiler.compile({
          mapName: "room",
          mapText: "{}",
          quality: "preview",
          expectedDocumentRevision: 7,
        });
        expect(result).toMatchObject({
          status,
          sourceDocumentRevision: 7,
          artifacts: expect.arrayContaining([
            {
              name: "room.pts",
              kind: "leak-path",
              stage: "qbsp",
              mediaType: "text/plain",
              data: expect.any(ArrayBuffer),
            },
          ]),
          logs: [
            {
              stage: "q2tool",
              text: expect.any(String),
              truncated: status === "failed",
            },
          ],
        });
        if (status === "succeeded") {
          expect(
            new Uint8Array(
              result.artifacts.find(({ kind }) => kind === "bsp")!.data,
            ),
          ).toEqual(Uint8Array.from([29, 0, 0, 0]));
        } else {
          expect(result.diagnostics).toContainEqual(
            expect.objectContaining({
              severity: "error",
              message: "q2tool exited with 1",
            }),
          );
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("accepts launch configuration only from machine-local absolute paths", () => {
    expect(
      configuredLaunchProfile({
        TEA_MAPS_LAUNCH_EXECUTABLE: "/games/quake",
        TEA_MAPS_LAUNCH_WORKING_DIRECTORY: "/games",
        TEA_MAPS_LAUNCH_MAP_DIRECTORY: "/games/id1/maps",
        TEA_MAPS_LAUNCH_ARGS_JSON: '["+map","%MAP%"]',
      }),
    ).toMatchObject({
      profileId: "default-launch",
      arguments: ["+map", "%MAP%"],
      game: "quake",
    });
    expect(() =>
      configuredLaunchProfile({
        TEA_MAPS_LAUNCH_EXECUTABLE: "quake",
        TEA_MAPS_LAUNCH_WORKING_DIRECTORY: "/games",
        TEA_MAPS_LAUNCH_MAP_DIRECTORY: "/games/id1/maps",
      }),
    ).toThrow(/absolute paths/);
    expect(() =>
      configuredLaunchProfile({
        TEA_MAPS_LAUNCH_EXECUTABLE: "/games/quake",
        TEA_MAPS_LAUNCH_WORKING_DIRECTORY: "/games",
        TEA_MAPS_LAUNCH_MAP_DIRECTORY: "/games/id1/maps",
        TEA_MAPS_LAUNCH_ARGS_JSON: '["+map", 7]',
      }),
    ).toThrow(/JSON array of strings/);
  });

  it("reports launch spawn failures and installs the BSP before starting a valid executable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tea-maps-launch-"));
    try {
      const build = {
        buildId: "launch-test",
        mapName: "test",
        sourceDocumentRevision: 4,
        bspBase64: "AQID",
      };
      const profile = {
        profileId: "local",
        label: "Local test",
        game: "quake" as const,
        executable: join(directory, "missing-executable"),
        arguments: [],
        workingDirectory: directory,
        mapDirectory: join(directory, "maps"),
      };
      await expect(launchBuild(build, profile)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        launchBuild(build, {
          ...profile,
          executable: process.execPath,
          arguments: ["--version"],
        }),
      ).resolves.toMatchObject({
        buildId: build.buildId,
        profileId: profile.profileId,
        sourceDocumentRevision: 4,
      });
      expect(await readFile(join(profile.mapDirectory, "test.bsp"))).toEqual(
        Buffer.from([1, 2, 3]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("enforces loopback origin and configured-profile request boundaries", () => {
    const origins = new Set(["http://127.0.0.1:5174"]);
    expect(originAllowed(undefined, origins)).toBe(true);
    expect(originAllowed("http://127.0.0.1:5174", origins)).toBe(true);
    expect(originAllowed("https://untrusted.invalid", origins)).toBe(false);
    expect(() =>
      parseCompileRequest({
        mapName: "test",
        mapText: "{}",
        quality: "preview",
        expectedDocumentRevision: 1,
        profileId: "arbitrary-command",
      }),
    ).toThrow(/Unknown compile profile/);
  });

  it("rejects unrecognized browser-controlled compiler and launcher fields", () => {
    expect(() =>
      parseCompileRequest({
        mapName: "test",
        mapText: "{}",
        quality: "final",
        expectedDocumentRevision: 9,
        profileId: "default",
        executable: "/tmp/untrusted",
      }),
    ).toThrow(/invalid compile fields/);
    expect(() =>
      parseLaunchRequest({
        buildId: "build-1",
        profileId: "launch-1",
        expectedDocumentRevision: 9,
        executable: "/tmp/untrusted",
      }),
    ).toThrow(/invalid launch fields/);
  });

  it("rejects oversized map and asset payloads before invoking native tools", () => {
    expect(() =>
      parseCompileRequest(
        {
          mapName: "large",
          mapText: "x".repeat(17),
          quality: "preview",
          expectedDocumentRevision: 1,
        },
        { maxMapBytes: 16, maxAssets: 1, maxAssetBase64Bytes: 8 },
      ),
    ).toThrow(/Map source exceeds/);
    expect(() =>
      parseCompileRequest(
        {
          mapName: "assets",
          mapText: "{}",
          quality: "preview",
          expectedDocumentRevision: 1,
          assets: [
            {
              name: "one.wad",
              mediaType: "application/octet-stream",
              base64: "AAAA",
            },
            {
              name: "two.wad",
              mediaType: "application/octet-stream",
              base64: "AAAA",
            },
          ],
        },
        { maxMapBytes: 16, maxAssets: 1, maxAssetBase64Bytes: 8 },
      ),
    ).toThrow(/invalid compile assets/);
    expect(() =>
      parseCompileRequest(
        {
          mapName: "assets",
          mapText: "{}",
          quality: "preview",
          expectedDocumentRevision: 1,
          assets: [
            {
              name: "one.wad",
              mediaType: "application/octet-stream",
              base64: "A".repeat(9),
            },
          ],
        },
        { maxMapBytes: 16, maxAssets: 1, maxAssetBase64Bytes: 8 },
      ),
    ).toThrow(/Compile assets exceed/);
  });

  it("advertises only configured capabilities and bounds launchable build retention", () => {
    expect(helperCapabilities(false, "quake", null)).toEqual({
      protocolVersion: 1,
      compileProfiles: [],
      launchProfiles: [],
    });
    expect(
      helperCapabilities(true, "goldsrc", null).compileProfiles[0],
    ).toMatchObject({
      id: "default",
      game: "goldsrc",
      qualities: ["preview", "final"],
    });
    expect(
      helperCapabilities(true, "quake2", null).compileProfiles[0],
    ).toMatchObject({
      game: "quake2",
      label: "Local q2tools-220",
    });

    const history = new BoundedBuildHistory(2);
    const request = parseCompileRequest({
      mapName: "test",
      mapText: "{}",
      quality: "preview",
      expectedDocumentRevision: 1,
    });
    history.remember(request, successfulBuild("one", 1));
    history.remember(request, successfulBuild("two", 2));
    history.remember(request, successfulBuild("three", 3));

    expect(history.get("one")).toBeUndefined();
    expect(history.get("three")).toMatchObject({ sourceDocumentRevision: 3 });
  });
});
