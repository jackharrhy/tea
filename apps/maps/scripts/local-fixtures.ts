import { createReadStream } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { discoverSteamCorpusFixtures } from "./steam-corpus-fixtures.ts";

interface FixtureMetadata {
  readonly label?: unknown;
  readonly aliases?: unknown;
  readonly camera?: unknown;
}

function contained(root: string, filename: string): boolean {
  const relative = path.relative(root, filename);
  return (
    Boolean(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function publicPath(value: string): string {
  return value.split(path.sep).map(encodeURIComponent).join("/");
}

async function bspFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry) => {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) return bspFiles(filename);
        return entry.isFile() && entry.name.toLowerCase().endsWith(".bsp")
          ? [filename]
          : [];
      }),
  );
  return nested.flat();
}

function cameraDefinition(value: unknown, filename: string) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${filename}: camera must be an object`);
  const camera = value as Record<string, unknown>;
  if (
    !Array.isArray(camera.position) ||
    camera.position.length !== 3 ||
    camera.position.some(
      (part) => typeof part !== "number" || !Number.isFinite(part),
    )
  ) {
    throw new Error(
      `${filename}: camera.position must contain three finite numbers`,
    );
  }
  const yawDegrees = camera.yawDegrees ?? 0;
  const pitchDegrees = camera.pitchDegrees ?? 0;
  const fieldOfView = camera.fieldOfView ?? 75;
  if (
    [yawDegrees, pitchDegrees, fieldOfView].some(
      (part) => typeof part !== "number" || !Number.isFinite(part),
    )
  ) {
    throw new Error(
      `${filename}: camera angles and field of view must be finite numbers`,
    );
  }
  return { position: camera.position, yawDegrees, pitchDegrees, fieldOfView };
}

async function fixtureMetadata(
  filename: string,
  fixtureRoot: string,
): Promise<FixtureMetadata> {
  try {
    const resolved = await realpath(filename);
    if (!contained(fixtureRoot, resolved))
      throw new Error("sidecar points outside its fixture directory");
    const parsed: unknown = JSON.parse(await readFile(resolved, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("metadata must be an object");
    return parsed as FixtureMetadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `${filename}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export async function discoverLocalFixtures(localRoot: string) {
  let directories;
  try {
    directories = (await readdir(localRoot, { withFileTypes: true })).filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "steam-installs",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const fixtures = [];
  for (const directory of directories) {
    const fixtureRoot = path.join(localRoot, directory.name);
    const realFixtureRoot = await realpath(fixtureRoot);
    const steam =
      directory.name === "steam-corpus"
        ? await discoverSteamCorpusFixtures(fixtureRoot)
        : undefined;
    const files = steam
      ? steam.levels.map((level) => level.filename)
      : (await bspFiles(fixtureRoot)).toSorted((left, right) =>
          left.localeCompare(right),
        );
    const steamLevels = new Map(
      steam?.levels.map((level) => [level.filename, level] as const) ?? [],
    );
    for (const filename of files) {
      const resolvedBsp = await realpath(filename);
      if (
        !contained(realFixtureRoot, resolvedBsp) ||
        !(await stat(resolvedBsp)).isFile()
      )
        throw new Error(
          `${filename}: BSP must be a file inside its fixture directory`,
        );
      const steamLevel = steamLevels.get(filename);
      const relativeBsp = path.relative(fixtureRoot, filename);
      const sidecar = filename.replace(/\.bsp$/iu, ".worldview.json");
      const walkability = filename.replace(
        /\.bsp$/iu,
        ".worldview-walkability.json",
      );
      const metadata = await fixtureMetadata(sidecar, realFixtureRoot);
      const id = steamLevel
        ? `steam-corpus/${steamLevel.game.slug}/${steamLevel.mapPath}`
        : files.length === 1
          ? directory.name
          : `${directory.name}/${relativeBsp.slice(0, -4).split(path.sep).join("/")}`;
      const label =
        metadata.label ??
        (steamLevel
          ? path.basename(filename)
          : `${path.basename(filename)} (local)`);
      if (typeof label !== "string" || !label.trim())
        throw new Error(`${sidecar}: label must be a non-empty string`);
      const aliases = metadata.aliases ?? [];
      if (
        !Array.isArray(aliases) ||
        aliases.some((alias) => typeof alias !== "string" || !alias.trim())
      ) {
        throw new Error(
          `${sidecar}: aliases must be an array of non-empty strings`,
        );
      }
      const fixtureBase = `/local/${encodeURIComponent(directory.name)}/`;
      const gameBase = steamLevel
        ? `${fixtureBase}${encodeURIComponent(steamLevel.appId)}/game/`
        : fixtureBase;
      const steamAssets = steamLevel
        ? (steam?.assetsByApp.get(steamLevel.appId) ?? [])
        : [];
      const gameAssets = Object.fromEntries(
        steamAssets.map((logicalPath) => [
          logicalPath,
          `${gameBase}${logicalPath.split("/").map(encodeURIComponent).join("/")}`,
        ]),
      );
      const camera =
        metadata.camera === undefined
          ? steamLevel?.game.anchor &&
            path.posix.basename(steamLevel.mapPath) === steamLevel.game.anchor
            ? steamLevel.game.anchorCamera
            : undefined
          : cameraDefinition(metadata.camera, sidecar);
      let hasWalkability = false;
      try {
        const resolved = await realpath(walkability);
        hasWalkability =
          contained(realFixtureRoot, resolved) &&
          (await stat(resolved)).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      fixtures.push({
        id,
        label: label.trim(),
        ...(steamLevel ? { namespace: steamLevel.game.name } : {}),
        aliases: [...new Set(aliases)],
        source: {
          bsp: `${fixtureBase}${publicPath(relativeBsp)}`,
          gameBaseUrl: gameBase,
          ...(steamAssets.length ? { gameAssets } : {}),
          ...(gameAssets["gfx/palette.lmp"]
            ? { palette: gameAssets["gfx/palette.lmp"] }
            : {}),
        },
        ...(camera
          ? { camera: { ...camera, fieldOfView: camera.fieldOfView ?? 75 } }
          : {}),
        ...(hasWalkability
          ? {
              walkability: `${fixtureBase}${publicPath(path.relative(fixtureRoot, walkability))}`,
            }
          : {}),
      });
    }
  }
  const ids = new Set<string>();
  for (const fixture of fixtures) {
    if (ids.has(fixture.id))
      throw new Error(`duplicate local fixture id ${fixture.id}`);
    ids.add(fixture.id);
  }
  return fixtures.toSorted((left, right) =>
    left.label.localeCompare(right.label),
  );
}

export async function resolveLocalFixture(
  localRoot: string,
  requestUrl: string,
) {
  let relative: string;
  try {
    const pathname = new URL(requestUrl, "http://localhost").pathname;
    if (!pathname.startsWith("/local/")) return null;
    relative = decodeURIComponent(pathname.slice("/local/".length));
  } catch {
    return null;
  }
  let root: string;
  try {
    root = await realpath(localRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const candidate = path.resolve(root, relative);
  if (!contained(root, candidate)) return null;
  let filename: string;
  try {
    filename = await realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!contained(root, filename)) return null;
  const information = await stat(filename);
  return information.isFile() ? { filename, size: information.size } : null;
}

export function localFixturesPlugin(localRoot: string): Plugin {
  return {
    name: "tea-maps-local-fixtures",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void (async () => {
          if (request.method !== "GET" && request.method !== "HEAD")
            return next();
          if (
            new URL(request.url ?? "/", "http://localhost").pathname ===
            "/local-fixtures.json"
          ) {
            const body = JSON.stringify(await discoverLocalFixtures(localRoot));
            response.setHeader(
              "Content-Type",
              "application/json; charset=utf-8",
            );
            response.setHeader("Cache-Control", "no-store");
            response.end(request.method === "HEAD" ? undefined : body);
            return;
          }
          const file = await resolveLocalFixture(localRoot, request.url ?? "");
          if (!file) return next();
          response.setHeader("Content-Type", "application/octet-stream");
          response.setHeader("Content-Length", file.size);
          if (request.method === "HEAD") return response.end();
          createReadStream(file.filename)
            .on("error", (error) => response.destroy(error))
            .pipe(response);
        })().catch(next);
      });
      server.watcher.add(localRoot);
      server.watcher.on("all", (event, filename) => {
        if (
          !["add", "change", "unlink", "addDir", "unlinkDir"].includes(event) ||
          !contained(localRoot, filename)
        )
          return;
        if (
          /\.(bsp|json|wad|wal|pcx|png|jpe?g|tga|spr|wav|mp3|ogg)$/iu.test(
            filename,
          )
        )
          server.ws.send({ type: "full-reload" });
      });
    },
  };
}
