import { createInflateRaw } from "zlib";

export interface ArchiveEntry {
  name: string; // Full path within archive: "textures/wall/brick.jpg"
  size: number; // Uncompressed size
  compressedSize?: number; // Compressed size (for ZIP/PK3)
  offset: number; // Offset in archive
  isDirectory: boolean;
}

export interface ParsedArchive {
  type: ArchiveType;
  entries: ArchiveEntry[];
}

export type ArchiveType = "pk3" | "pak" | "zip" | "unknown";

export function detectArchiveType(buffer: Buffer): ArchiveType {
  if (buffer.length < 4) return "unknown";

  const magic = buffer.toString("ascii", 0, 4);

  if (magic === "PK\x03\x04" || magic === "PK\x05\x06") return "pk3";
  if (magic === "PACK") return "pak";

  return "unknown";
}

export function parsePk3(buffer: Buffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];

  // Find end of central directory
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Invalid PK3/ZIP: End of central directory not found");
  }

  // Read central directory info
  const cdEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  // Parse central directory
  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (
      buffer[pos] !== 0x50 ||
      buffer[pos + 1] !== 0x4b ||
      buffer[pos + 2] !== 0x01 ||
      buffer[pos + 3] !== 0x02
    ) {
      break;
    }

    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localHeaderOffset = buffer.readUInt32LE(pos + 42);

    const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLength);
    const isDirectory = name.endsWith("/");

    entries.push({
      name: name.replace(/\/$/, ""),
      size: uncompressedSize,
      compressedSize,
      offset: localHeaderOffset,
      isDirectory,
    });

    pos += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

export async function extractPk3Entry(
  buffer: Buffer,
  entry: ArchiveEntry,
): Promise<Buffer> {
  // Read local file header
  const pos = entry.offset;
  if (
    buffer[pos] !== 0x50 ||
    buffer[pos + 1] !== 0x4b ||
    buffer[pos + 2] !== 0x03 ||
    buffer[pos + 3] !== 0x04
  ) {
    throw new Error("Invalid local file header");
  }

  const compressionMethod = buffer.readUInt16LE(pos + 8);
  const compressedSize = buffer.readUInt32LE(pos + 18);
  const nameLength = buffer.readUInt16LE(pos + 26);
  const extraLength = buffer.readUInt16LE(pos + 28);

  const dataOffset = pos + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);

  // No compression
  if (compressionMethod === 0) {
    return Buffer.from(compressed);
  }

  // Deflate compression
  if (compressionMethod === 8) {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const inflate = createInflateRaw();

      inflate.on("data", (chunk) => chunks.push(chunk));
      inflate.on("end", () => resolve(Buffer.concat(chunks)));
      inflate.on("error", reject);

      inflate.write(compressed);
      inflate.end();
    });
  }

  throw new Error(`Unsupported compression method: ${compressionMethod}`);
}

export function parsePak(buffer: Buffer): ArchiveEntry[] {
  // Read header
  const magic = buffer.toString("ascii", 0, 4);
  if (magic !== "PACK") {
    throw new Error("Invalid PAK file: Bad magic");
  }

  const dirOffset = buffer.readInt32LE(4);
  const dirSize = buffer.readInt32LE(8);
  const numEntries = dirSize / 64;

  const entries: ArchiveEntry[] = [];

  for (let i = 0; i < numEntries; i++) {
    const entryOffset = dirOffset + i * 64;

    // Name is 56 bytes, null-terminated
    let nameEnd = entryOffset;
    while (nameEnd < entryOffset + 56 && buffer[nameEnd] !== 0) {
      nameEnd++;
    }
    const name = buffer.toString("ascii", entryOffset, nameEnd);

    const fileOffset = buffer.readInt32LE(entryOffset + 56);
    const fileSize = buffer.readInt32LE(entryOffset + 60);

    entries.push({
      name,
      size: fileSize,
      offset: fileOffset,
      isDirectory: false,
    });
  }

  return entries;
}

export function extractPakEntry(buffer: Buffer, entry: ArchiveEntry): Buffer {
  return Buffer.from(buffer.subarray(entry.offset, entry.offset + entry.size));
}

export function parseArchive(buffer: Buffer): ParsedArchive {
  const type = detectArchiveType(buffer);

  let entries: ArchiveEntry[];

  switch (type) {
    case "pk3":
      entries = parsePk3(buffer);
      break;
    case "pak":
      entries = parsePak(buffer);
      break;
    default:
      throw new Error(`Unsupported archive type: ${type}`);
  }

  return { type, entries };
}

export function getDirectoryPaths(entries: ArchiveEntry[]): string[] {
  const dirs = new Set<string>();

  for (const entry of entries) {
    if (entry.isDirectory) {
      dirs.add(entry.name);
    } else {
      // Add parent directories
      const lastSlash = entry.name.lastIndexOf("/");
      if (lastSlash > 0) {
        const parts = entry.name.substring(0, lastSlash).split("/");
        for (let i = 1; i <= parts.length; i++) {
          dirs.add(parts.slice(0, i).join("/"));
        }
      }
    }
  }

  return Array.from(dirs).toSorted();
}

export function getFileEntries(entries: ArchiveEntry[]): ArchiveEntry[] {
  return entries.filter((e) => !e.isDirectory && e.size > 0);
}
