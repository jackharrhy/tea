import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";

import type { SqliteDatabase } from "remix/data-table/sqlite";
import type { FileUpload } from "remix/form-data-parser";
import sharp from "sharp";

import { attachments, type Attachment } from "./schema.ts";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_STORED_UPLOAD_BYTES = 500 * 1024 * 1024;

const MAX_INPUT_PIXELS = 40_000_000;
const MAX_OUTPUT_DIMENSION = 2400;
const STALE_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;
const supportedFormats = new Set(["jpeg", "png", "webp"]);

export interface StoredAttachment {
  byteSize: number;
  height: number;
  id: string;
  mimeType: "image/webp";
  src: string;
  width: number;
}

export class AttachmentUploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export class AttachmentStore {
  readonly directory: string;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    readonly database: SqliteDatabase,
    directory: string,
  ) {
    this.directory = path.resolve(directory);
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true });
    await this.removeStaleUploads();
  }

  async create(
    file: FileUpload,
    draftToken: string,
  ): Promise<StoredAttachment> {
    let input = Buffer.from(await file.arrayBuffer());
    let source = sharp(input, {
      failOn: "warning",
      limitInputPixels: MAX_INPUT_PIXELS,
    });

    let metadata;
    try {
      metadata = await source.metadata();
    } catch {
      throw new AttachmentUploadError(
        "Choose a valid JPEG, PNG, or WebP image.",
      );
    }

    if (
      !metadata.format ||
      !supportedFormats.has(metadata.format) ||
      (metadata.pages ?? 1) > 1
    ) {
      throw new AttachmentUploadError(
        "Choose a still JPEG, PNG, or WebP image.",
      );
    }

    let result;
    try {
      result = await sharp(input, {
        failOn: "warning",
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .rotate()
        .resize({
          fit: "inside",
          height: MAX_OUTPUT_DIMENSION,
          width: MAX_OUTPUT_DIMENSION,
          withoutEnlargement: true,
        })
        .webp({ effort: 4, quality: 82, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new AttachmentUploadError(
        "That image could not be prepared for the letter.",
      );
    }

    if (
      !result.info.width ||
      !result.info.height ||
      result.data.byteLength === 0
    ) {
      throw new AttachmentUploadError(
        "That image could not be prepared for the letter.",
      );
    }

    return this.exclusive(async () => {
      await this.removeStaleUploadsUnlocked();
      let usedBytes = await this.readStoredBytes();
      if (usedBytes + result.data.byteLength > MAX_STORED_UPLOAD_BYTES) {
        throw new AttachmentUploadError(
          "The image store is full right now. Please send this letter without another image.",
          507,
        );
      }

      let id = randomUUID();
      let storageKey = `${id}.webp`;
      let filename = this.filename(storageKey);
      await writeFile(filename, result.data, { flag: "wx" });

      try {
        await this.database.create(attachments, {
          id,
          draft_token: draftToken,
          letter_id: null,
          storage_key: storageKey,
          mime_type: "image/webp",
          byte_size: result.data.byteLength,
          width: result.info.width,
          height: result.info.height,
          is_public: false,
          created_at: Date.now(),
        });
      } catch (error) {
        await removeFile(filename);
        throw error;
      }

      return {
        byteSize: result.data.byteLength,
        height: result.info.height,
        id,
        mimeType: "image/webp",
        src: `/uploads/${id}`,
        width: result.info.width,
      };
    });
  }

  async find(id: string): Promise<Attachment | null> {
    return this.database.find(attachments, id);
  }

  pathFor(attachment: Attachment): string {
    return this.filename(attachment.storage_key);
  }

  async removeUnclaimed(id: string, draftToken: string) {
    await this.exclusive(async () => {
      let attachment = await this.database.find(attachments, id);
      if (
        !attachment ||
        attachment.letter_id !== null ||
        attachment.draft_token !== draftToken
      )
        return;
      await removeFile(this.pathFor(attachment));
      await this.database.delete(attachments, attachment.id);
    });
  }

  async removeUnclaimedForDraft(draftToken: string, keepIds: string[]) {
    await this.exclusive(async () => {
      let all = await this.database.findMany(attachments, {
        where: { draft_token: draftToken },
      });
      let keep = new Set(keepIds);
      for (let attachment of all) {
        if (attachment.letter_id !== null || keep.has(attachment.id)) continue;
        await removeFile(this.pathFor(attachment));
        await this.database.delete(attachments, attachment.id);
      }
    });
  }

  async removeStaleUploads() {
    await this.exclusive(() => this.removeStaleUploadsUnlocked());
  }

  private async removeStaleUploadsUnlocked() {
    let cutoff = Date.now() - STALE_UPLOAD_AGE_MS;
    let all = await this.database.findMany(attachments);
    for (let attachment of all) {
      if (attachment.letter_id !== null || attachment.created_at >= cutoff)
        continue;
      await removeFile(this.pathFor(attachment));
      await this.database.delete(attachments, attachment.id);
    }
  }

  private async readStoredBytes(): Promise<number> {
    let entries = await readdir(this.directory, { withFileTypes: true });
    let total = 0;
    for (let entry of entries) {
      if (!entry.isFile()) continue;
      let info = await stat(this.filename(entry.name));
      total += info.size;
    }
    return total;
  }

  private filename(storageKey: string): string {
    if (!/^[0-9a-f-]+\.webp$/i.test(storageKey)) {
      throw new Error("Invalid attachment storage key.");
    }
    return path.join(this.directory, storageKey);
  }

  private async exclusive<value>(task: () => Promise<value>): Promise<value> {
    let previous = this.#queue;
    let release!: () => void;
    this.#queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

async function removeFile(filename: string) {
  try {
    await unlink(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
