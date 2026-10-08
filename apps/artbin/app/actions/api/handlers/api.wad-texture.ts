import type * as Route from "./types.ts";
import { requireSessionUser } from "#lib/session-auth.server";
import {
  getVisibleWADLibrary,
  getWADTexturePreview,
} from "#lib/wad-assets.server";

export async function loader({
  request,
  params,
}: Route.LoaderArgsWithParams<{ fileId: string; textureIndex: string }>) {
  const user = await requireSessionUser(request);
  const textureIndex = Number(params.textureIndex);
  if (!Number.isSafeInteger(textureIndex) || textureIndex < 0) {
    return new Response("Texture not found", { status: 404 });
  }

  const library = await getVisibleWADLibrary(params.fileId, user);
  if (!library) return new Response("WAD not found", { status: 404 });

  const preview = await getWADTexturePreview(library.file, textureIndex, user);
  if (!preview) return new Response("Texture not found", { status: 404 });

  return new Response(Uint8Array.from(preview), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(preview.length),
    },
  });
}
