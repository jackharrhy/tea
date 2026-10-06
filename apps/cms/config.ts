import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import * as s from "remix/data-schema";
import type { SitePresentation, SiteRuntime } from "./app/site.ts";

type SiteEntry = {
  id: string;
  config: unknown;
  presentation: SitePresentation;
};

const originSchema = s.string().refine((origin) => {
  const url = URL.parse(origin);
  return (
    !!url && ["http:", "https:"].includes(url.protocol) && url.origin === origin
  );
});
const siteSchema = s.object({
  name: s.string().refine((name) => !!name.trim()),
  origin: originSchema,
  aliases: s.array(s.string()),
  preview: s.boolean(),
  features: s.object({ adornments: s.boolean(), riso: s.boolean() }),
  background: s.string().refine((color) => /^#[0-9a-fA-F]{6}$/.test(color)),
});
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;

function registerHost(host: string, id: string, hosts: Set<string>) {
  if (
    !host ||
    /[\s/@?#]/.test(host) ||
    URL.parse(`https://${host}`)?.host !== host
  )
    throw new Error(`Invalid hostname for ${id}: ${host}`);
  if (hosts.has(host)) throw new Error(`Hostname already registered: ${host}`);
  hosts.add(host);
}

export function parseSites(
  input: SiteEntry[],
  dataRoot: string,
): SiteRuntime[] {
  if (!input.length) throw new Error("No CMS sites found.");
  const ids = new Set<string>();
  const hosts = new Set<string>();
  return input.map(({ id, config, presentation }) => {
    if (!idPattern.test(id)) throw new Error(`Invalid site ID: ${id}`);
    if (ids.has(id)) throw new Error(`Site ID already registered: ${id}`);
    ids.add(id);
    const row = s.parse(siteSchema, config);
    const origin = new URL(row.origin);
    for (const host of [origin.host, ...row.aliases])
      registerHost(host, id, hosts);
    return {
      id,
      name: row.name,
      origin: row.origin,
      aliases: row.aliases,
      preview: row.preview,
      dataDir: resolve(dataRoot, id),
      definition: {
        ...presentation,
        features: row.features,
        background: row.background,
      },
    };
  });
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function readConfig(dir: string, localOverrides: boolean) {
  const base = await readJson(join(dir, "site.json"));
  if (!localOverrides) return base;
  const local = await readFile(join(dir, "site.local.json"), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  return {
    ...base,
    ...(local ? (JSON.parse(local) as Record<string, unknown>) : {}),
  };
}

export async function loadRegistry(
  sitesRoot = fileURLToPath(new URL("./sites", import.meta.url)),
  dataRoot = resolve(process.env.TEA_DATA_DIR ?? "data"),
  localOverrides = true,
) {
  const entries = await readdir(sitesRoot, { withFileTypes: true });
  const sites: SiteEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(sitesRoot, entry.name);
    const id = entry.name;
    if (!idPattern.test(id)) throw new Error(`Invalid site ID: ${id}`);
    const config = await readConfig(dir, localOverrides);
    const module = (await import(
      pathToFileURL(join(dir, "app/site.ts")).href
    )) as { default: SitePresentation };
    sites.push({ id, config, presentation: module.default });
  }
  return parseSites(sites, dataRoot);
}

export async function loadSites() {
  return loadRegistry();
}

export function parseOperatorOrigin(
  input: string | undefined,
  sites: SiteRuntime[],
) {
  if (!input) return undefined;
  const origin = s.parse(originSchema, input);
  const host = new URL(origin).host;
  if (
    sites.some((site) =>
      [new URL(site.origin).host, ...site.aliases].includes(host),
    )
  )
    throw new Error(`Hostname already registered: ${host}`);
  return origin;
}
