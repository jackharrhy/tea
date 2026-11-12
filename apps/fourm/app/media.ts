import type { Bindings, Runtime } from "./runtime.ts";
import type { Member } from "./data/community.ts";
import { CommunityError } from "./data/community.ts";
import { uploadLimit } from "./data/media.ts";
import { mediaRanges } from "./media-range.ts";
import type { ByteRange } from "./media-range.ts";

export async function uploadMedia(
  request: Request,
  env: Bindings,
  store: Runtime,
  actor: Member,
) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File))
    throw new CommunityError(422, "Choose a file to upload");
  if (file.size > uploadLimit)
    throw new CommunityError(413, "Files must be 10 MB or smaller");
  const filename =
    file.name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-120) || "file";
  const path = `${actor.username}/${crypto.randomUUID()}-${filename}`;
  await store.call(
    "reserveUpload",
    actor.id,
    path,
    file.type || "application/octet-stream",
    file.size,
  );
  try {
    await env.MEDIA.put(path, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    return await store.call("finishUpload", actor.id, path);
  } catch (error) {
    await store.call("abandonUpload", actor.id, path);
    throw error;
  }
}
export async function readMedia(
  request: Request,
  env: Bindings,
  store: Runtime,
  path: string,
) {
  const record = await store.call("publishedMedia", path);
  const object = await env.MEDIA.head(path);
  if (!object) throw new CommunityError(404, "Media bytes are unavailable");
  const modified = object.uploaded.toUTCString();
  const headers = new Headers({
    "Content-Type": String(record.mime_type),
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "Content-Length": String(object.size),
    ETag: object.httpEtag,
    "Last-Modified": modified,
  });
  const etags = request.headers.get("If-None-Match");
  const notModified = etags
    ? etags.trim() === "*" ||
      etags
        .split(",")
        .some((tag) => tag.trim().replace(/^W\//, "") === object.httpEtag)
    : Date.parse(request.headers.get("If-Modified-Since") ?? "") >=
      Date.parse(modified);
  if (notModified) {
    headers.delete("Content-Length");
    return new Response(null, { status: 304, headers });
  }
  let ranges: ByteRange[] = [];
  const range = request.headers.get("Range"),
    ifRange = request.headers.get("If-Range");
  if (
    range &&
    (!ifRange || ifRange === object.httpEtag || ifRange === modified)
  ) {
    try {
      ranges = mediaRanges(range, object.size);
    } catch (error) {
      if (!(error instanceof CommunityError)) throw error;
      return new Response(error.status === 416 ? null : error.message, {
        status: error.status,
        headers:
          error.status === 416
            ? { "Content-Range": `bytes */${object.size}` }
            : undefined,
      });
    }
  }
  const isHead = request.method === "HEAD";
  async function* bytes(part?: ByteRange): AsyncGenerator<Uint8Array> {
    const result = await env.MEDIA.get(path, {
      onlyIf: { etagMatches: object!.etag },
      ...(part
        ? { range: { offset: part.start, length: part.end - part.start } }
        : {}),
    });
    if (!result || !("body" in result))
      throw new Error("Media changed during response");
    const reader = result.body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        yield next.value;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
  const encoder = new TextEncoder();
  const boundary = crypto.randomUUID().replaceAll("-", "");
  const prefix = (part: ByteRange) =>
    encoder.encode(
      `--${boundary}\r\nContent-Type: ${record.mime_type}\r\nContent-Range: bytes ${part.start}-${part.end - 1}/${object.size}\r\n\r\n`,
    );
  const ending = encoder.encode(`--${boundary}--`);
  const newline = encoder.encode("\r\n");
  if (ranges.length === 1) {
    const part = ranges[0];
    headers.set(
      "Content-Range",
      `bytes ${part.start}-${part.end - 1}/${object.size}`,
    );
    headers.set("Content-Length", String(part.end - part.start));
  } else if (ranges.length > 1) {
    headers.set("Content-Type", `multipart/byteranges; boundary=${boundary}`);
    headers.set(
      "Content-Length",
      String(
        ending.byteLength +
          ranges.reduce(
            (size, part) =>
              size +
              prefix(part).byteLength +
              part.end -
              part.start +
              newline.byteLength,
            0,
          ),
      ),
    );
  }
  async function* body() {
    if (ranges.length <= 1) yield* bytes(ranges[0]);
    else {
      for (const part of ranges) {
        yield prefix(part);
        yield* bytes(part);
        yield newline;
      }
      yield ending;
    }
  }
  const iterator = body();
  const stream = isHead
    ? null
    : new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await iterator.next();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel() {
          await iterator.return();
        },
      });
  return new Response(stream, { status: ranges.length ? 206 : 200, headers });
}
