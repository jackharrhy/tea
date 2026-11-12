import type { Bindings, Runtime } from "./runtime.ts";
import type { Member } from "./data/community.ts";
import { CommunityError } from "./data/community.ts";
import { uploadLimit } from "./data/media.ts";

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
export async function readMedia(env: Bindings, store: Runtime, path: string) {
  const record = await store.call("publishedMedia", path);
  const object = await env.MEDIA.get(path);
  if (!object) throw new CommunityError(404, "Media bytes are unavailable");
  const headers = new Headers({
    "Content-Type": String(record.mime_type),
    "X-Content-Type-Options": "nosniff",
  });
  return new Response(object.body, { headers });
}
