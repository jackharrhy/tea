import { access, cp, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const [installArg, map, fixtureArg] = process.argv.slice(2);
if (!installArg || !map || !/^[a-zA-Z0-9_-]+$/.test(map)) {
  throw new Error(
    "Usage: node scripts/archive-goldsrc-client.mjs <game-install-dir> <map-name> [fixture-name]",
  );
}

const fixture = fixtureArg ?? `steam-${map}`;
if (!/^[a-zA-Z0-9_-]+$/.test(fixture)) throw new Error("Invalid fixture name");
const destination = path.resolve(import.meta.dirname, "../local", fixture);
const install = path.resolve(installArg);
const roots = ["svencoop_downloads", "svencoop_addon", "svencoop"].map((name) =>
  path.join(install, name),
);

async function locate(relative) {
  for (const root of roots) {
    const filename = path.join(root, relative);
    try {
      await access(filename);
      return filename;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function archive(relative, required = false) {
  const source = await locate(relative);
  if (!source) {
    if (required) throw new Error(`Missing ${relative} in ${install}`);
    console.warn(`Missing ${relative}`);
    return false;
  }
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log(`Archived ${relative} from ${path.relative(install, source)}`);
  return true;
}

function resourcePaths(text) {
  return [...text.matchAll(/^\s*"?([a-zA-Z0-9_./-]+)"?\s*(?:\/\/.*)?$/gm)]
    .map((match) => match[1])
    .filter(
      (value) =>
        !value.startsWith("/") &&
        !value.split("/").includes("..") &&
        /^(?:gfx|maps|models|sound|sprites)\/|^[^/]+\.wad$/i.test(value),
    );
}

const bspPath = `maps/${map}.bsp`;
const bspSource = await locate(bspPath);
if (!bspSource) throw new Error(`Missing ${bspPath} in ${install}`);
const bsp = await readFile(bspSource);
if (bsp.length < 124 || bsp.readInt32LE(0) !== 30) {
  throw new Error(`${bspSource} is not a GoldSrc BSP30 map`);
}

await mkdir(destination);
await archive(bspPath, true);
const manifestPath = `maps/${map}.res`;
const manifestSource = await locate(manifestPath);
if (manifestSource) {
  await archive(manifestPath);
  const manifest = await readFile(manifestSource, "utf8");
  for (const relative of new Set(resourcePaths(manifest))) await archive(relative);
}

for (const root of roots) {
  const source = path.join(root, "sound/player");
  try {
    await access(source);
    await cp(source, path.join(destination, "sound/player"), { recursive: true });
    console.log(`Archived sound/player from ${path.relative(install, source)}`);
    break;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

console.log(
  `Open /viewer?fixture=${encodeURIComponent(fixture)} with the Maps dev server running.`,
);
