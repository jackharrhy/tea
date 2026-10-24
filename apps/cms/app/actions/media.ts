import { safeUploadPath } from "../data/upload-path.ts";
import { transaction } from "../data/transaction.ts";
import { basename, join, resolve } from "node:path";
import { mkdir, writeFile, unlink, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { openLazyFile } from "remix/fs";
import { createFileResponse } from "remix/response/file";
import { parseFormData } from "remix/form-data-parser";
import type { ContentStore } from "../data/content.ts";
import { invalid } from "./input.ts";

const uploadDirectory = (store?: ContentStore) =>
  resolve(
    store?.options.dataDir ?? process.env.TEA_DATA_DIR ?? "data",
    "uploads",
  );
export { safeUploadPath } from "../data/upload-path.ts";
export async function serveMedia(
  request: Request,
  id: string,
  store: ContentStore,
) {
  const row = store.mediaItem(id);
  if (!row) return new Response("Media not found", { status: 404 });
  const path = safeUploadPath(uploadDirectory(store), row.path);
  if (!path) return new Response("Media not found", { status: 404 });
  const stat = await lstat(path).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink())
    return new Response("Media file is missing", { status: 410 });
  const response = await createFileResponse(
    openLazyFile(path, { type: row.mime_type }),
    request,
    { cacheControl: "public, max-age=31536000, immutable", acceptRanges: true },
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Content-Security-Policy",
    "sandbox; default-src 'none'; style-src 'unsafe-inline'",
  );
  if (
    !/^(image\/(png|jpeg|gif|webp|avif|svg\+xml)|audio\/|video\/|application\/pdf)/.test(
      row.mime_type,
    )
  )
    response.headers.set("Content-Disposition", "attachment");
  return response;
}
function detect(bytes: Buffer): { type: string; ext: string } | null {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { type: "image/png", ext: "png" };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { type: "image/jpeg", ext: "jpg" };
  if (/^GIF8[79]a/.test(bytes.toString("ascii", 0, 6)))
    return { type: "image/gif", ext: "gif" };
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return { type: "image/webp", ext: "webp" };
  if (bytes.toString("ascii", 0, 5) === "%PDF-")
    return { type: "application/pdf", ext: "pdf" };
  if (
    bytes.toString("ascii", 0, 3) === "ID3" ||
    (bytes[0] === 255 && (bytes[1] & 224) === 224)
  )
    return { type: "audio/mpeg", ext: "mp3" };
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WAVE"
  )
    return { type: "audio/wav", ext: "wav" };
  if (bytes.toString("ascii", 4, 8) === "ftyp")
    return bytes.toString("ascii", 8, 12).includes("avi")
      ? { type: "image/avif", ext: "avif" }
      : { type: "video/mp4", ext: "mp4" };
  return null;
}
export async function uploadMedia(request: Request, store: ContentStore) {
  let form: FormData;
  try {
    form = await parseFormData(request, {
      maxFileSize: 25 * 1024 * 1024,
      maxTotalSize: 26 * 1024 * 1024,
    });
  } catch {
    return invalid("Choose a supported file smaller than 25 MB.", 413);
  }
  const folder = form.get("folder_id");
  if (
    folder &&
    (typeof folder !== "string" ||
      !store.sqlite
        .prepare("SELECT 1 FROM media_folders WHERE id=?")
        .get(folder))
  )
    return invalid("Folder not found.");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size)
    return invalid("Choose a file to upload.");
  const bytes = Buffer.from(await file.arrayBuffer()),
    format = detect(bytes);
  if (!format)
    return invalid(
      "Supported files: PNG, JPEG, GIF, WebP, AVIF, PDF, MP3, WAV and MP4.",
    );
  const id = randomUUID(),
    path = `${id}.${format.ext}`,
    directory = uploadDirectory(store);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, path), bytes, { flag: "wx" });
  try {
    store.sqlite.exec("BEGIN IMMEDIATE");
    store.sqlite
      .prepare(
        "INSERT INTO media (id,filename,mime_type,size,path,alt) VALUES (?,?,?,?,?,?)",
      )
      .run(
        id,
        basename(file.name).slice(0, 255),
        format.type,
        bytes.length,
        path,
        String(form.get("alt") ?? "").slice(0, 2000),
      );
    if (folder)
      store.sqlite
        .prepare("INSERT INTO media_details (media_id,folder_id) VALUES (?,?)")
        .run(id, folder);
    store.sqlite.exec("COMMIT");
  } catch (error) {
    store.sqlite.exec("ROLLBACK");
    await unlink(join(directory, path));
    throw error;
  }
  return Response.json(
    { ok: true, item: store.media().find((m) => m.id === id) },
    { status: 201 },
  );
}
export function deleteMedia(id: string, store: ContentStore) {
  return transaction(store.sqlite, () => {
    const row = store.mediaItem(id);
    if (!row) return invalid("Media not found.", 404);
    const references = store.mediaReferences(id);
    if (references.length)
      return invalid(
        "Still used by " +
          references.join(", ") +
          ". Remove those references first.",
        409,
      );
    // Keep the original file recoverable; the database record is the public lookup boundary.
    store.history("media", id, row);
    store.sqlite.prepare("DELETE FROM media WHERE id=?").run(id);
    return Response.json({ ok: true });
  });
}
