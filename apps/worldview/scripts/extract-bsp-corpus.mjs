#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  extname,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

const ZIP_EXTENSIONS = new Set([".pk3", ".zip"]);
const PAK_DIRECTORY_RECORD_SIZE = 64;
const PAK_NAME_SIZE = 56;
const MAX_PAK_RECORDS = 1_000_000;
const MAX_ARCHIVE_LIST_BYTES = 16 * 1024 * 1024;
const REPLACEMENT_TEXTURE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tga",
]);

function usage() {
  console.log(`Usage:
  node scripts/extract-bsp-corpus.mjs --output DIRECTORY --source APP_ID=DIRECTORY [...]

Discovers loose BSP files and extracts BSP entries from ZIP/PK3 and Quake PACK archives. It also
materializes GoldSrc WADs, Quake palettes, and Quake II palettes, textures, and skyboxes beneath
each app's game root. The output preserves source provenance and includes a manifest with SHA-256
hashes.`);
}

function parseArguments(arguments_) {
  let output;
  const sources = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      usage();
      process.exit(0);
    }
    if (argument === "--output") {
      output = arguments_[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--source") {
      const source = arguments_[index + 1];
      index += 1;
      const separator = source?.indexOf("=") ?? -1;
      if (separator <= 0) throw new Error("--source must use APP_ID=DIRECTORY");
      const appId = source.slice(0, separator);
      if (!/^\d+$/.test(appId))
        throw new Error(`invalid Steam app ID: ${appId}`);
      sources.push({ appId, path: resolve(source.slice(separator + 1)) });
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (!output) throw new Error("--output is required");
  if (sources.length === 0)
    throw new Error("at least one --source is required");
  return { output: resolve(output), sources };
}

async function* walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

function safeArchiveEntry(entry) {
  const normalized = posix.normalize(entry.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw new Error(`unsafe archive entry: ${entry}`);
  }
  return normalized;
}

function outputPath(outputRoot, ...parts) {
  const path = resolve(outputRoot, ...parts);
  if (path !== outputRoot && !path.startsWith(`${outputRoot}${sep}`)) {
    throw new Error(`output path escapes the corpus: ${path}`);
  }
  return path;
}

function gameAssetPath(entry) {
  const normalized = safeArchiveEntry(entry).toLowerCase();
  if (extname(normalized) === ".wad") return posix.basename(normalized);
  if (
    normalized === "gfx/palette.lmp" ||
    normalized.endsWith("/gfx/palette.lmp")
  ) {
    return "gfx/palette.lmp";
  }
  const parts = normalized.split("/");
  const rootIndex = parts.findIndex(
    (part) => part === "textures" || part === "pics" || part === "env",
  );
  if (rootIndex < 0) return null;
  const isGoldSrcSkybox =
    parts[rootIndex] === "env" && parts[rootIndex - 1] === "gfx";
  const logical = parts
    .slice(isGoldSrcSkybox ? rootIndex - 1 : rootIndex)
    .join("/");
  const extension = extname(logical);
  if (logical === "pics/colormap.pcx") return logical;
  if (
    logical.startsWith("textures/") &&
    (extension === ".wal" || REPLACEMENT_TEXTURE_EXTENSIONS.has(extension))
  ) {
    return logical;
  }
  if (
    (logical.startsWith("env/") || logical.startsWith("gfx/env/")) &&
    REPLACEMENT_TEXTURE_EXTENSIONS.has(extension)
  ) {
    return logical;
  }
  return null;
}

async function capture(command, arguments_) {
  const child = spawn(command, arguments_, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  const errors = [];
  let byteLength = 0;
  child.stdout.on("data", (chunk) => {
    byteLength += chunk.length;
    if (byteLength > MAX_ARCHIVE_LIST_BYTES) child.kill("SIGKILL");
    else output.push(chunk);
  });
  child.stderr.on("data", (chunk) => errors.push(chunk));
  const code = await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("close", accept);
  });
  if (byteLength > MAX_ARCHIVE_LIST_BYTES) {
    throw new Error(`${command} produced an unreasonable archive listing`);
  }
  if (code !== 0) {
    throw new Error(
      Buffer.concat(errors).toString("utf8").trim() ||
        `${command} exited ${code}`,
    );
  }
  return Buffer.concat(output).toString("utf8");
}

async function commandToFile(command, arguments_, target) {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.part-${process.pid}`;
  const child = spawn(command, arguments_, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const errors = [];
  child.stderr.on("data", (chunk) => errors.push(chunk));
  try {
    const [code] = await Promise.all([
      new Promise((accept, reject) => {
        child.once("error", reject);
        child.once("close", accept);
      }),
      pipeline(child.stdout, createWriteStream(temporary)),
    ]);
    if (code !== 0) {
      throw new Error(
        Buffer.concat(errors).toString("utf8").trim() ||
          `${command} exited ${code}`,
      );
    }
    await rename(temporary, target);
  } catch (error) {
    child.kill("SIGKILL");
    await rm(temporary, { force: true });
    throw error;
  }
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function recordExtraction(records, outputRoot, details) {
  const information = await stat(details.outputPath);
  records.push({
    appId: details.appId,
    container: details.container,
    entry: details.entry,
    outputPath: relative(outputRoot, details.outputPath).replaceAll(sep, "/"),
    size: information.size,
    sha256: await hashFile(details.outputPath),
  });
}

async function recordAssetExtraction(assets, outputRoot, details) {
  const information = await stat(details.outputPath);
  assets.set(`${details.appId}/${details.logicalPath}`, {
    appId: details.appId,
    container: details.container,
    entry: details.entry,
    logicalPath: details.logicalPath,
    outputPath: relative(outputRoot, details.outputPath).replaceAll(sep, "/"),
    size: information.size,
    sha256: await hashFile(details.outputPath),
  });
}

async function extractZip(records, assets, options) {
  const listing = await capture("unzip", ["-Z1", options.archivePath]);
  const entries = listing.split(/\r?\n/u).filter(Boolean);
  for (const entry of entries) {
    const normalized = safeArchiveEntry(entry);
    if (normalized.toLowerCase().endsWith(".bsp")) {
      const target = outputPath(
        options.outputRoot,
        options.appId,
        "archives",
        ...relative(options.sourceRoot, options.archivePath).split(sep),
        ...normalized.split("/"),
      );
      await commandToFile("unzip", ["-p", options.archivePath, entry], target);
      await recordExtraction(records, options.outputRoot, {
        appId: options.appId,
        container: options.archivePath,
        entry: normalized,
        outputPath: target,
      });
    }
    const logicalPath = gameAssetPath(normalized);
    if (logicalPath) {
      const target = outputPath(
        options.outputRoot,
        options.appId,
        "game",
        ...logicalPath.split("/"),
      );
      await commandToFile("unzip", ["-p", options.archivePath, entry], target);
      await recordAssetExtraction(assets, options.outputRoot, {
        appId: options.appId,
        container: options.archivePath,
        entry: normalized,
        logicalPath,
        outputPath: target,
      });
    }
  }
}

async function extractPak(records, assets, options) {
  const information = await stat(options.archivePath);
  const handle = await open(options.archivePath, "r");
  try {
    const header = Buffer.alloc(12);
    const headerRead = await handle.read({ buffer: header, position: 0 });
    if (headerRead.bytesRead !== header.length) return;
    if (header.toString("ascii", 0, 4) !== "PACK") return;
    const directoryOffset = header.readUInt32LE(4);
    const directoryLength = header.readUInt32LE(8);
    if (
      directoryLength % PAK_DIRECTORY_RECORD_SIZE !== 0 ||
      directoryLength / PAK_DIRECTORY_RECORD_SIZE > MAX_PAK_RECORDS ||
      directoryOffset + directoryLength > information.size
    ) {
      throw new Error(`invalid PACK directory in ${options.archivePath}`);
    }
    const directory = Buffer.alloc(directoryLength);
    const directoryRead = await handle.read({
      buffer: directory,
      position: directoryOffset,
    });
    if (directoryRead.bytesRead !== directory.length) {
      throw new Error(`truncated PACK directory in ${options.archivePath}`);
    }
    for (
      let offset = 0;
      offset < directory.length;
      offset += PAK_DIRECTORY_RECORD_SIZE
    ) {
      const terminator = directory.indexOf(0, offset);
      const nameEnd =
        terminator >= offset && terminator < offset + PAK_NAME_SIZE
          ? terminator
          : offset + PAK_NAME_SIZE;
      const entry = safeArchiveEntry(
        directory.toString("utf8", offset, nameEnd),
      );
      const isBsp = entry.toLowerCase().endsWith(".bsp");
      const logicalPath = gameAssetPath(entry);
      if (!isBsp && !logicalPath) continue;
      const dataOffset = directory.readUInt32LE(offset + PAK_NAME_SIZE);
      const dataLength = directory.readUInt32LE(offset + PAK_NAME_SIZE + 4);
      if (dataOffset + dataLength > information.size) {
        throw new Error(`PACK entry ${entry} exceeds ${options.archivePath}`);
      }
      const target = isBsp
        ? outputPath(
            options.outputRoot,
            options.appId,
            "archives",
            ...relative(options.sourceRoot, options.archivePath).split(sep),
            ...entry.split("/"),
          )
        : outputPath(
            options.outputRoot,
            options.appId,
            "game",
            ...logicalPath.split("/"),
          );
      await mkdir(dirname(target), { recursive: true });
      if (dataLength === 0) await writeFile(target, Buffer.alloc(0));
      else {
        await pipeline(
          createReadStream(options.archivePath, {
            start: dataOffset,
            end: dataOffset + dataLength - 1,
          }),
          createWriteStream(target),
        );
      }
      if (isBsp) {
        await recordExtraction(records, options.outputRoot, {
          appId: options.appId,
          container: options.archivePath,
          entry,
          outputPath: target,
        });
      } else {
        await recordAssetExtraction(assets, options.outputRoot, {
          appId: options.appId,
          container: options.archivePath,
          entry,
          logicalPath,
          outputPath: target,
        });
      }
    }
  } finally {
    await handle.close();
  }
}

async function extractSource(records, assets, source, outputRoot) {
  const paths = [];
  for await (const path of walk(source.path)) paths.push(path);
  const archives = [];
  for (const path of paths) {
    const extension = extname(path).toLowerCase();
    if (extension === ".bsp") {
      const entry = relative(source.path, path);
      const target = outputPath(
        outputRoot,
        source.appId,
        "loose",
        ...entry.split(sep),
      );
      await mkdir(dirname(target), { recursive: true });
      await copyFile(path, target);
      await recordExtraction(records, outputRoot, {
        appId: source.appId,
        container: null,
        entry: entry.replaceAll(sep, "/"),
        outputPath: target,
      });
    } else if (ZIP_EXTENSIONS.has(extension) || extension === ".pak")
      archives.push(path);
    else {
      const entry = relative(source.path, path).replaceAll(sep, "/");
      const logicalPath = gameAssetPath(entry);
      if (!logicalPath) continue;
      const target = outputPath(
        outputRoot,
        source.appId,
        "game",
        ...logicalPath.split("/"),
      );
      await mkdir(dirname(target), { recursive: true });
      await copyFile(path, target);
      await recordAssetExtraction(assets, outputRoot, {
        appId: source.appId,
        container: null,
        entry,
        logicalPath,
        outputPath: target,
      });
    }
  }
  for (const archivePath of archives.toSorted((left, right) =>
    left.localeCompare(right),
  )) {
    const extension = extname(archivePath).toLowerCase();
    const extraction = ZIP_EXTENSIONS.has(extension) ? extractZip : extractPak;
    await extraction(records, assets, {
      appId: source.appId,
      archivePath,
      sourceRoot: source.path,
      outputRoot,
    });
  }
}

const options = parseArguments(process.argv.slice(2));
await mkdir(options.output, { recursive: true });
const records = [];
const assets = new Map();
for (const source of options.sources) {
  console.log(`Scanning Steam app ${source.appId}: ${source.path}`);
  await extractSource(records, assets, source, options.output);
}
records.sort((left, right) =>
  `${left.appId}/${left.container ?? ""}/${left.entry}`.localeCompare(
    `${right.appId}/${right.container ?? ""}/${right.entry}`,
  ),
);
await writeFile(
  join(options.output, "manifest.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      records,
      assets: [...assets.values()].toSorted((left, right) =>
        `${left.appId}/${left.logicalPath}`.localeCompare(
          `${right.appId}/${right.logicalPath}`,
        ),
      ),
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Extracted ${records.length} BSP files and ${assets.size} game assets into ${options.output}`,
);
