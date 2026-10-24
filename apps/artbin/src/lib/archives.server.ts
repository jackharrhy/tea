/**
 * Archive extraction utilities for artbin
 *
 * Thin adapter: reads files from disk and delegates to @tea/artbin-core buffer-based parsers.
 */

import { readFile } from "fs/promises";
import { extname } from "path";
import {
  detectArchiveType as detectArchiveTypeFromBuffer,
  parsePk3 as parsePk3FromBuffer,
  extractPk3Entry as extractPk3EntryFromBuffer,
  parsePak as parsePakFromBuffer,
  extractPakEntry as extractPakEntryFromBuffer,
  getDirectoryPaths,
  getFileEntries,
  type ArchiveEntry,
  type ParsedArchive,
  type ArchiveType,
} from "@tea/artbin-core/parsers/archives";

// Re-export types and pure functions for backward compatibility
export type { ArchiveEntry, ParsedArchive, ArchiveType };
export { getDirectoryPaths, getFileEntries };

async function detectArchiveType(filePath: string): Promise<ArchiveType> {
  const ext = extname(filePath).slice(1).toLowerCase();

  // Check extension first (matches original behavior)
  if (ext === "pk3" || ext === "pk4" || ext === "zip") return "pk3";
  if (ext === "pak") return "pak";

  // Fall back to magic bytes
  const buffer = await readFile(filePath);
  return detectArchiveTypeFromBuffer(buffer);
}

async function extractPk3Entry(
  filePath: string,
  entry: ArchiveEntry,
): Promise<Buffer> {
  const buffer = await readFile(filePath);
  return extractPk3EntryFromBuffer(buffer, entry);
}

async function extractPakEntry(
  filePath: string,
  entry: ArchiveEntry,
): Promise<Buffer> {
  const buffer = await readFile(filePath);
  return Buffer.from(extractPakEntryFromBuffer(buffer, entry));
}

export async function parseArchive(filePath: string): Promise<ParsedArchive> {
  const type = await detectArchiveType(filePath);
  const buffer = await readFile(filePath);

  let entries: ArchiveEntry[];

  switch (type) {
    case "pk3":
      entries = parsePk3FromBuffer(buffer);
      break;
    case "pak":
      entries = parsePakFromBuffer(buffer);
      break;
    default:
      throw new Error(`Unsupported archive type: ${type}`);
  }

  return { type, entries };
}

export async function extractEntry(
  filePath: string,
  entry: ArchiveEntry,
  archiveType: ArchiveType,
): Promise<Buffer> {
  switch (archiveType) {
    case "pk3":
      return extractPk3Entry(filePath, entry);
    case "pak":
      return extractPakEntry(filePath, entry);
    default:
      throw new Error(`Unsupported archive type: ${archiveType}`);
  }
}
