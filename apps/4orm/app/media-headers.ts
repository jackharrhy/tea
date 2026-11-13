import registry from "./data/media-registry.json" with { type: "json" };
import { CommunityError } from "./data/community.ts";
const mediaTypes: Readonly<Record<string, string>> = registry.types;
const mediaSuffixes: Readonly<Record<string, string>> = registry.suffixes;
const mediaEncodings: Readonly<Record<string, string>> = registry.encodings;

function splitExtension(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1),
    dot = name.lastIndexOf(".");
  if (dot < 0 || /^\.*$/.test(name.slice(0, dot))) return [path, ""];
  const extension = name.slice(dot);
  return [path.slice(0, -extension.length), extension];
}

export function mediaContentType(path: string) {
  let [base, extension] = splitExtension(path);
  while (mediaSuffixes[extension.toLowerCase()])
    [base, extension] = splitExtension(
      base + mediaSuffixes[extension.toLowerCase()],
    );
  if (mediaEncodings[extension]) [, extension] = splitExtension(base);
  const type =
    mediaTypes[extension.toLowerCase()] ?? "application/octet-stream";
  return type.startsWith("text/") ? type + "; charset=utf-8" : type;
}

export function sourceMediaMetadata(value: {
  last_modified?: unknown;
  etag?: unknown;
  mtime_ns?: unknown;
}) {
  const metadata: Record<string, string> = {};
  if (value.last_modified !== undefined) {
    if (
      typeof value.last_modified !== "string" ||
      !Number.isFinite(Date.parse(value.last_modified)) ||
      new Date(value.last_modified).toUTCString() !== value.last_modified
    )
      throw new CommunityError(422, "Invalid archive modification date");
    metadata.fourm_last_modified = value.last_modified;
  }
  if (value.etag !== undefined) {
    if (typeof value.etag !== "string" || !/^"[!#-~]{1,128}"$/.test(value.etag))
      throw new CommunityError(422, "Invalid archive ETag");
    metadata.fourm_etag = value.etag;
  }
  if (value.mtime_ns !== undefined) {
    if (
      typeof value.mtime_ns !== "string" ||
      !/^-?\d{1,30}$/.test(value.mtime_ns)
    )
      throw new CommunityError(422, "Invalid archive file timestamp");
    metadata.fourm_mtime_ns = value.mtime_ns;
  }
  return metadata;
}
