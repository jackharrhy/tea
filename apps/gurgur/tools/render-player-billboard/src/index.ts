import { exists } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const blendFile = join(
  repositoryRoot,
  "content",
  "characters",
  "player-billboard",
  "player-billboard-harness.blend",
);
const pythonScript = join(
  repositoryRoot,
  "tools",
  "render-player-billboard",
  "render.py",
);
const outputDirectory = join(
  repositoryRoot,
  "content",
  "generated",
  "player-billboard",
);

const blenderCandidates = [
  process.env.BLENDER_BIN,
  Bun.which("blender"),
  process.platform === "darwin"
    ? "/Applications/Blender.app/Contents/MacOS/Blender"
    : undefined,
].filter(
  (candidate): candidate is string => candidate != null && candidate.length > 0,
);
const blender = (
  await Promise.all(
    blenderCandidates.map(async (candidate) =>
      (await exists(candidate)) ? candidate : null,
    ),
  )
).find((candidate): candidate is string => candidate !== null);

if (!blender) {
  throw new Error(
    "Blender was not found; install it, put it on PATH, or set BLENDER_BIN to its executable",
  );
}
if (!(await exists(blendFile)))
  throw new Error(`missing authored blend file: ${blendFile}`);

const child = Bun.spawn(
  [
    blender,
    "--background",
    blendFile,
    "--python-exit-code",
    "1",
    "--python",
    pythonScript,
    "--",
    "--output",
    outputDirectory,
    ...Bun.argv.slice(2),
  ],
  {
    cwd: repositoryRoot,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  },
);
const exitCode = await child.exited;
if (exitCode !== 0) process.exit(exitCode);
if (Bun.argv.includes("--setup-only")) process.exit(0);

const metadata = join(outputDirectory, "player-billboard.json");
const atlas = join(outputDirectory, "player-billboard.png");
if (!(await exists(metadata)) || !(await exists(atlas))) {
  throw new Error(
    `Blender exited successfully without producing output in ${dirname(metadata)}`,
  );
}
