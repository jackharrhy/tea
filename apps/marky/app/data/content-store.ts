import * as fs from "node:fs/promises";
import * as path from "node:path";

import { MARKDOWN_EXTENSION } from "../shared/constants.ts";

// Filesystem layer for the markdown content directory. Pure data access:
// no Yjs, no sockets, no awareness.

export interface ContentStoreOptions {
  dir: string;
}

export class ContentStore {
  readonly dir: string;

  constructor(options: ContentStoreOptions) {
    this.dir = options.dir;
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.dir);
      return entries.filter((f) => f.endsWith(MARKDOWN_EXTENSION)).toSorted();
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  }

  async read(filename: string): Promise<string | null> {
    assertSafeFilename(filename);
    try {
      return await fs.readFile(this.filePath(filename), "utf-8");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async readOrCreate(filename: string): Promise<string> {
    const existing = await this.read(filename);
    if (existing !== null) return existing;
    await this.write(filename, "");
    return "";
  }

  async write(filename: string, content: string): Promise<void> {
    assertSafeFilename(filename);
    await this.ensureDir();
    await fs.writeFile(this.filePath(filename), content, "utf-8");
  }

  async rename(args: { oldName: string; newName: string }): Promise<void> {
    assertSafeFilename(args.oldName);
    assertSafeFilename(args.newName);
    if (args.oldName === args.newName) return;

    const newPath = this.filePath(args.newName);
    try {
      await fs.access(newPath);
      throw new Error(`Filename already exists: ${args.newName}`);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    await fs.rename(this.filePath(args.oldName), newPath);
  }

  async remove(filename: string): Promise<void> {
    assertSafeFilename(filename);
    try {
      await fs.unlink(this.filePath(filename));
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }

  filePath(filename: string): string {
    return path.join(this.dir, filename);
  }
}

function assertSafeFilename(filename: string): void {
  // Markdown files only, no path separators, no traversal. Filenames are user
  // input from the websocket; this is the boundary check.
  if (!filename.endsWith(MARKDOWN_EXTENSION)) {
    throw new Error(
      `Filename must end with ${MARKDOWN_EXTENSION}: ${filename}`,
    );
  }
  if (
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("..")
  ) {
    throw new Error(`Filename contains path separators: ${filename}`);
  }
  if (filename.length === 0 || filename === MARKDOWN_EXTENSION) {
    throw new Error(`Filename is empty: ${filename}`);
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
