import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { buildGardenIndex, canonicalRouteId } from "./garden-routing.mjs";

export interface GardenEntry {
  id: string;
  sourcePath: string;
  body: string;
  source: string;
  data: {
    public: true;
    title?: string;
    name?: string;
    description?: string;
    "og-image"?: string;
    custom_layout?: string;
    "custom-layout"?: string;
    aliases?: string[];
  };
}

function readFrontmatter(source: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { data: {}, body: source };
  const data: unknown = parse(match[1], { maxAliasCount: 50 });
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Frontmatter must be a mapping");
  return {
    data: data as Record<string, unknown>,
    body: source.slice(match[0].length),
  };
}

function walkFiles(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.name.startsWith(".")) return [];
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return walkFiles(target);
      return entry.isFile() ? [target] : [];
    })
    .toSorted();
}

export function createContentStore(directory: string) {
  let current: ReturnType<typeof load> | undefined;
  let revision = 0;

  function load() {
    if (!fs.existsSync(directory))
      throw new Error(
        `Garden content directory not found: ${directory}. Set GARDEN_VAULT_PATH for development or GARDEN_CONTENT_PATH for production.`,
      );
    const entries: GardenEntry[] = [];
    for (const file of walkFiles(directory)) {
      if (!file.endsWith(".md")) continue;
      const source = fs.readFileSync(file, "utf8");
      const { data, body } = readFrontmatter(source);
      if (data.public !== true) continue;
      const sourcePath = path
        .relative(directory, file)
        .split(path.sep)
        .join("/");
      for (const key of [
        "title",
        "name",
        "description",
        "og-image",
        "custom_layout",
        "custom-layout",
      ]) {
        if (data[key] !== undefined && typeof data[key] !== "string")
          throw new Error(`${sourcePath}: ${key} must be a string`);
      }
      if (
        data.aliases !== undefined &&
        (!Array.isArray(data.aliases) ||
          !data.aliases.every((alias) => typeof alias === "string"))
      )
        throw new Error(`${sourcePath}: aliases must be strings`);
      entries.push({
        id: canonicalRouteId(sourcePath),
        sourcePath,
        source,
        body,
        data: data as GardenEntry["data"],
      });
    }
    const index = buildGardenIndex(
      entries.map((entry) => ({
        path: entry.sourcePath,
        aliases: entry.data.aliases,
      })),
    );
    const collision = index.collisions.find((item) => item.type === "route");
    if (collision)
      throw new Error(
        `Garden route collision: ${collision.key} (${collision.entries.map((entry) => entry.sourcePath).join(", ")})`,
      );
    return {
      entries,
      index,
      byId: new Map(entries.map((entry) => [entry.id, entry])),
    };
  }

  return {
    read() {
      return (current ??= load());
    },
    invalidate() {
      current = undefined;
      revision++;
    },
    get revision() {
      return revision;
    },
  };
}
