import { createController } from "remix/router";
import {
  AppRuntime,
  Authenticated,
  CurrentSessionToken,
} from "../../data/runtime.ts";
import { tokenHash } from "../../data/crypto.ts";
import {
  cachePreviewImage,
  isGenericSocialPreview,
  normalizeLinkUrl,
  previewLink,
} from "../../data/link-preview.ts";
import { imageType, MAX_UPLOAD_BYTES } from "../../data/image-upload.ts";
import type { AppContext } from "../../router.ts";
import { routes } from "../../routes.ts";

export default createController(routes.resources, {
  actions: {
    async snapshot(context) {
      const access = await boardAccess(context);
      if (!access) return new Response("Not found", { status: 404 });
      const snapshot = await context
        .get(AppRuntime)!
        .board(context.params.boardId)
        .snapshot(context.params.boardId);
      return Response.json(snapshot, {
        headers: { "Cache-Control": "private, no-store" },
      });
    },
    async websocket(context) {
      const access = await boardAccess(context);
      if (!access) return new Response("Not found", { status: 404 });
      const token = context.get(CurrentSessionToken);
      if (!token) return new Response("Unauthorized", { status: 401 });
      const headers = new Headers(context.request.headers);
      headers.set("x-ref-board", context.params.boardId);
      headers.set("x-ref-session-hash", await tokenHash(token));
      return context
        .get(AppRuntime)!
        .board(context.params.boardId)
        .fetch(new Request(context.request.url, { headers }));
    },
    async upload(context) {
      const access = await boardAccess(context);
      if (!access) return new Response("Forbidden", { status: 403 });
      const length = Number(context.request.headers.get("Content-Length"));
      if (length > MAX_UPLOAD_BYTES + 100_000)
        return new Response("Image too large", { status: 413 });
      const form = context.get(FormData)!;
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        file.size === 0 ||
        file.size > MAX_UPLOAD_BYTES
      )
        return new Response("Image must be 20 MB or less", { status: 413 });
      const type = await imageType(file, MAX_UPLOAD_BYTES);
      if (!type)
        return new Response("PNG, JPEG, GIF, or WebP required", {
          status: 415,
        });
      const assetId = crypto.randomUUID();
      const boardId = context.params.boardId;
      const objectKey = `boards/${boardId}/${assetId}`;
      const runtime = context.get(AppRuntime)!;
      await runtime.media.put(objectKey, file.stream(), {
        httpMetadata: { contentType: type },
      });
      const filename = file.name.slice(0, 160) || "Image";
      try {
        await runtime.board(boardId).recordAsset(boardId, {
          id: assetId,
          objectKey,
          filename,
          contentType: type,
          size: file.size,
        });
      } catch (error) {
        await runtime.media.delete(objectKey);
        throw error;
      }
      return Response.json(
        { assetId, filename, url: `/media/${boardId}/${assetId}` },
        { status: 201 },
      );
    },
    async link(context) {
      if (!(await boardAccess(context)))
        return new Response("Forbidden", { status: 403 });
      const form = context.get(FormData)!;
      const url = normalizeLinkUrl(String(form.get("url") ?? ""));
      if (!url) return new Response("Enter a public web URL", { status: 400 });
      const refresh = form.get("refresh") === "1";
      const runtime = context.get(AppRuntime)!;
      const board = runtime.board(context.params.boardId);
      const existing = await board.existingLink(context.params.boardId, url);
      if (existing && !refresh) return Response.json(existing);
      if (refresh && !existing)
        return new Response("Link is no longer on this board", { status: 404 });
      const fetched = await previewLink(url);
      if (refresh && (!fetched.imageUrl || isGenericSocialPreview(fetched)))
        return new Response("The post did not provide a usable preview yet", {
          status: 422,
        });
      const preview = await cachePreviewImage(
        fetched,
        runtime.media,
        context.params.boardId,
      );
      if (
        refresh &&
        !preview.imageUrl?.startsWith(`/previews/${context.params.boardId}/`)
      )
        return new Response("Could not cache the new preview image", {
          status: 502,
        });
      if (existing) {
        const updated = await board.refreshLink(
          context.params.boardId,
          existing.assetId,
          preview,
        );
        return updated
          ? Response.json(updated)
          : new Response("Link is no longer on this board", { status: 404 });
      }
      const saved = await board.recordLink(context.params.boardId, preview);
      return Response.json(saved, { status: 201 });
    },
    async preview(context) {
      if (!(await boardAccess(context)))
        return new Response("Not found", { status: 404 });
      const hash = context.params.imageId;
      if (!/^[0-9a-f]{64}$/.test(hash))
        return new Response("Not found", { status: 404 });
      const object = await context
        .get(AppRuntime)!
        .media.get(`boards/${context.params.boardId}/previews/${hash}`);
      if (!object) return new Response("Not found", { status: 404 });
      return privateImageResponse(
        context.request,
        object,
        object.httpMetadata?.contentType ?? "application/octet-stream",
      );
    },
    async media(context) {
      const access = await boardAccess(context);
      if (!access) return new Response("Not found", { status: 404 });
      const runtime = context.get(AppRuntime)!;
      const asset = await runtime
        .board(context.params.boardId)
        .asset(context.params.boardId, context.params.assetId);
      if (!asset) return new Response("Not found", { status: 404 });
      const object = await runtime.media.get(asset.objectKey);
      if (!object) return new Response("Not found", { status: 404 });
      return privateImageResponse(context.request, object, asset.contentType);
    },
  },
});

async function privateImageResponse(
  request: Request,
  object: R2ObjectBody,
  contentType: string,
): Promise<Response> {
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, no-cache",
    "Content-Security-Policy": "default-src none; sandbox",
    ETag: object.httpEtag,
  });
  if (request.headers.get("If-None-Match") === object.httpEtag) {
    await object.body.cancel().catch(() => undefined);
    return new Response(null, { status: 304, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}

async function boardAccess(
  context: AppContext & { params: { boardId: string } },
) {
  if (!context.get(Authenticated)) return null;
  return context.get(AppRuntime)!.directory.board(context.params.boardId);
}
