import { createHash } from "node:crypto";
import { basename } from "node:path";

import { validatePublicHttpsUrl } from "./public-remote-url.server.ts";

export type RemoteImportProvider = "gamebanana" | "scmapdb" | "direct";

export interface ParsedRemoteImportUrl {
  provider: RemoteImportProvider;
  externalId: string;
  canonicalUrl: string;
}

export interface RemoteImportFile {
  name: string;
  url: string;
  size?: number;
  md5?: string;
}

export interface RemoteImportManifest extends ParsedRemoteImportUrl {
  title: string;
  author: string | null;
  game: string | null;
  description: string | null;
  files: RemoteImportFile[];
  metadata: Record<string, unknown>;
}

export function describeRemoteImport(manifest: RemoteImportManifest): string {
  if (manifest.description) return manifest.description;

  const details = [
    manifest.author ? `by ${manifest.author}` : null,
    manifest.game ? `for ${manifest.game}` : null,
  ].filter(Boolean);
  const provider =
    manifest.provider === "gamebanana"
      ? "GameBanana"
      : manifest.provider === "scmapdb"
        ? "SCMapDB"
        : new URL(manifest.canonicalUrl).hostname;
  return `${manifest.title}${details.length ? ` ${details.join(" ")}` : ""}, published on ${provider}.`;
}

const ARCHIVE_FILE_PATTERN = /\.(?:zip|7z|rar)(?:\.\d{3})?$/i;
const REQUEST_HEADERS = {
  "user-agent": "artbin/0.1 (+https://github.com/jackharrhy/tea)",
  accept: "application/json,text/html;q=0.9,*/*;q=0.5",
};

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRemoteImportUrl(input: string): ParsedRemoteImportUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Import URLs must use HTTP or HTTPS");
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "gamebanana.com") {
    const match = url.pathname.match(/^\/mods\/(\d+)(?:\/|$)/);
    if (!match)
      throw new Error("GameBanana URLs must point to a mod or map page");
    return {
      provider: "gamebanana",
      externalId: match[1],
      canonicalUrl: `https://gamebanana.com/mods/${match[1]}`,
    };
  }

  if (host === "scmapdb.com" || host === "scmapdb.wikidot.com") {
    const match = url.pathname.match(/^\/map:([a-z0-9_-]+)(?:\/|$)/i);
    if (!match) throw new Error("SCMapDB URLs must point to a map page");
    const externalId = match[1].toLowerCase();
    return {
      provider: "scmapdb",
      externalId,
      canonicalUrl: `https://scmapdb.wikidot.com/map:${externalId}`,
    };
  }

  const directUrl = validatePublicHttpsUrl(url.toString());
  let fileName: string;
  try {
    fileName = basename(decodeURIComponent(directUrl.pathname));
  } catch {
    throw new Error("Direct archive URL contains an invalid encoded filename");
  }
  if (!/\.(?:zip|7z|rar)$/i.test(fileName)) {
    throw new Error(
      "Supported sources are GameBanana pages, SCMapDB pages, and direct ZIP, 7z, or RAR URLs",
    );
  }
  directUrl.hash = "";
  const canonicalUrl = directUrl.toString();
  return {
    provider: "direct",
    externalId: createHash("sha256")
      .update(canonicalUrl)
      .digest("hex")
      .slice(0, 24),
    canonicalUrl,
  };
}

export function isAllowedRemoteDownloadUrl(
  provider: RemoteImportProvider,
  input: string,
): boolean {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (provider === "gamebanana") {
      return host === "gamebanana.com" || host.endsWith(".gamebanana.com");
    }
    if (provider === "scmapdb") return host === "scmapdb.wdfiles.com";
    validatePublicHttpsUrl(url.toString());
    return true;
  } catch {
    return false;
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Source returned ${response.status} ${response.statusText}`,
    );
  return response.text();
}

async function fetchGameBananaManifest(
  parsed: ParsedRemoteImportUrl,
): Promise<RemoteImportManifest> {
  const apiUrl = new URL("https://api.gamebanana.com/Core/Item/Data");
  apiUrl.searchParams.set("itemtype", "Mod");
  apiUrl.searchParams.set("itemid", parsed.externalId);
  apiUrl.searchParams.set(
    "fields",
    "name,description,Files().aFiles(),Url().sProfileUrl(),Owner().name,Game().name",
  );
  apiUrl.searchParams.set("return_keys", "true");

  const raw = JSON.parse(await fetchText(apiUrl.toString())) as Record<
    string,
    unknown
  >;
  const title = typeof raw.name === "string" ? raw.name.trim() : "";
  const fileData = raw["Files().aFiles()"];
  const fileRecords =
    fileData && typeof fileData === "object"
      ? Object.values(fileData as Record<string, Record<string, unknown>>)
      : [];
  const files: RemoteImportFile[] = [];

  for (const file of fileRecords) {
    if (file["_bIsArchived"] === true) continue;
    const name =
      typeof file["_sFile"] === "string" ? basename(file["_sFile"]) : "";
    const url =
      typeof file["_sDownloadUrl"] === "string" ? file["_sDownloadUrl"] : "";
    if (!name || !url || !isAllowedRemoteDownloadUrl("gamebanana", url))
      continue;

    const avResult =
      typeof file["_sAvResult"] === "string" ? file["_sAvResult"] : "";
    if (avResult && avResult !== "clean") continue;
    files.push({
      name,
      url,
      ...(typeof file["_nFilesize"] === "number"
        ? { size: file["_nFilesize"] }
        : {}),
      ...(typeof file["_sMd5Checksum"] === "string"
        ? { md5: file["_sMd5Checksum"] }
        : {}),
    });
  }

  if (!title)
    throw new Error("GameBanana did not return a title for this submission");
  if (files.length === 0)
    throw new Error("GameBanana did not return any active, clean files");

  return {
    ...parsed,
    title,
    author:
      typeof raw["Owner().name"] === "string" ? raw["Owner().name"] : null,
    game: typeof raw["Game().name"] === "string" ? raw["Game().name"] : null,
    description:
      typeof raw.description === "string"
        ? stripHtml(raw.description).slice(0, 5_000)
        : null,
    files,
    metadata: raw,
  };
}

function toOfficialScMapDbAttachment(
  input: string,
  baseUrl: string,
): string | null {
  try {
    const url = new URL(decodeHtml(input), baseUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      host !== "scmapdb.com" &&
      host !== "scmapdb.wikidot.com" &&
      host !== "scmapdb.wdfiles.com"
    ) {
      return null;
    }
    if (!url.pathname.includes("/local--files/")) return null;
    url.protocol = "https:";
    url.hostname = "scmapdb.wdfiles.com";
    url.port = "";
    return url.toString();
  } catch {
    return null;
  }
}

function selectPreferredScMapDbFiles(
  files: RemoteImportFile[],
): RemoteImportFile[] {
  const first = files[0];
  if (!first) return [];

  const volumeMatch = first.name.match(/^(.*\.(?:zip|7z))\.001$/i);
  if (volumeMatch) {
    return files.filter((file) =>
      new RegExp(
        `^${volumeMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\d{3}$`,
        "i",
      ).test(file.name),
    );
  }

  const partMatch = first.name.match(
    /^(.*?)([-_.](?:part|pt)[-_.]?)(0*1)(\.[^.]+)$/i,
  );
  if (partMatch) {
    const escapedPrefix = partMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedMarker = partMatch[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedExtension = partMatch[4].replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const partPattern = new RegExp(
      `^${escapedPrefix}${escapedMarker}0*\\d+${escapedExtension}$`,
      "i",
    );
    return files.filter((file) => partPattern.test(file.name));
  }

  // SCMapDB lists its recommended/current package first, followed by old
  // versions and mirrors. Importing every attachment duplicates content and
  // makes a stale mirror capable of failing an otherwise valid import.
  return [first];
}

async function fetchScMapDbManifest(
  parsed: ParsedRemoteImportUrl,
): Promise<RemoteImportManifest> {
  const html = await fetchText(parsed.canonicalUrl);
  const titleMatch = html.match(
    /<div[^>]+id=["']page-title["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  const authorMatch = html.match(
    /<strong>\s*Author\s*<\/strong>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i,
  );
  const descriptionMatch = html.match(
    /<h2[^>]*>\s*<span>\s*Description\s*<\/span>\s*<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/i,
  );
  const title = titleMatch ? stripHtml(titleMatch[1]) : "";
  if (!title) throw new Error("SCMapDB did not return a map title");

  const downloadStart = html.search(
    /<div[^>]+class=["'][^"']*\bdl\b[^"']*["']/i,
  );
  const downloadEnd = html.indexOf("dl-how-to-install", downloadStart);
  const downloadHtml =
    downloadStart >= 0
      ? html.slice(
          downloadStart,
          downloadEnd > downloadStart ? downloadEnd : undefined,
        )
      : "";
  const links = Array.from(
    downloadHtml.matchAll(/<a[^>]+href=["']([^"']+)["']/gi),
    (match) => match[1],
  );
  const seen = new Set<string>();
  const files: RemoteImportFile[] = [];

  for (const link of links) {
    const url = toOfficialScMapDbAttachment(link, parsed.canonicalUrl);
    if (!url || seen.has(url)) continue;
    const name = basename(decodeURIComponent(new URL(url).pathname));
    if (!ARCHIVE_FILE_PATTERN.test(name)) continue;
    seen.add(url);
    files.push({ name, url });
  }

  const preferredFiles = selectPreferredScMapDbFiles(files);
  if (preferredFiles.length === 0) {
    throw new Error(
      "SCMapDB did not expose a supported official ZIP, 7z, or RAR attachment",
    );
  }

  return {
    ...parsed,
    title,
    author: authorMatch ? stripHtml(authorMatch[1]) : null,
    game: "Sven Co-op",
    description: descriptionMatch
      ? stripHtml(descriptionMatch[1]).slice(0, 5_000)
      : null,
    files: preferredFiles,
    metadata: { pageTitle: title, attachmentCount: files.length },
  };
}

function fetchDirectArchiveManifest(
  parsed: ParsedRemoteImportUrl,
): RemoteImportManifest {
  const url = validatePublicHttpsUrl(parsed.canonicalUrl);
  const name = basename(decodeURIComponent(url.pathname));
  const title = name
    .replace(/\.(?:zip|7z|rar)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

  return {
    ...parsed,
    title: title || "Imported Archive",
    author: null,
    game: null,
    description: `Imported from ${url.hostname}.`,
    files: [{ name, url: parsed.canonicalUrl }],
    metadata: { host: url.hostname, directArchive: true },
  };
}

export async function fetchRemoteImportManifest(
  input: string,
): Promise<RemoteImportManifest> {
  const parsed = parseRemoteImportUrl(input);
  if (parsed.provider === "gamebanana") return fetchGameBananaManifest(parsed);
  if (parsed.provider === "scmapdb") return fetchScMapDbManifest(parsed);
  return fetchDirectArchiveManifest(parsed);
}
