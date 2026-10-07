import { createHash } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredBlob {
  readonly sha256: string;
  readonly size: number;
}

export interface BlobStore {
  put(data: Uint8Array): Promise<StoredBlob>;
  putStream(
    source: AsyncIterable<Uint8Array>,
    maxBytes: number,
  ): Promise<StoredBlob>;
  get(sha256: string): Promise<Uint8Array | null>;
  openStream(
    sha256: string,
  ): Promise<{ size: number; body: ReadStream } | null>;
}

function validHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export class FileBlobStore implements BlobStore {
  public constructor(private readonly root: string) {}

  private path(hash: string): string {
    if (!validHash(hash)) throw new Error("Invalid blob hash");
    return join(this.root, hash.slice(0, 2), hash.slice(2));
  }

  public async put(data: Uint8Array): Promise<StoredBlob> {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const destination = this.path(sha256);
    await mkdir(dirname(destination), { recursive: true });
    try {
      const existing = await stat(destination);
      if (existing.size !== data.byteLength)
        throw new Error("Blob hash collision");
      return { sha256, size: data.byteLength };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, data, { flag: "wx" });
    try {
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return { sha256, size: data.byteLength };
  }

  public async get(sha256: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.path(sha256));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  public async putStream(
    source: AsyncIterable<Uint8Array>,
    maxBytes: number,
  ): Promise<StoredBlob> {
    await mkdir(this.root, { recursive: true });
    const temporary = join(this.root, `${crypto.randomUUID()}.upload`);
    const file = await open(temporary, "wx");
    const hash = createHash("sha256");
    let size = 0;
    try {
      for await (const chunk of source) {
        size += chunk.byteLength;
        if (size > maxBytes)
          throw Object.assign(
            new Error("Project assets must be at most 512 MiB per file"),
            {
              status: 413,
            },
          );
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.byteLength) {
          const result = await file.write(
            chunk,
            offset,
            chunk.byteLength - offset,
            null,
          );
          offset += result.bytesWritten;
        }
      }
    } catch (error) {
      await file.close();
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    await file.close();
    const sha256 = hash.digest("hex");
    const destination = this.path(sha256);
    await mkdir(dirname(destination), { recursive: true });
    try {
      const existing = await stat(destination);
      if (existing.size !== size) throw new Error("Blob hash collision");
      await unlink(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      await rename(temporary, destination);
    }
    return { sha256, size };
  }

  public async openStream(
    sha256: string,
  ): Promise<{ size: number; body: ReadStream } | null> {
    try {
      const path = this.path(sha256);
      const details = await stat(path);
      return { size: details.size, body: createReadStream(path) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
