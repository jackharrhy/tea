import { createController } from "remix/router";
import { get, post, route } from "remix/routes";
import { renderToString } from "remix/component/server";
import type { RemixNode } from "remix/component";
import type { Bindings, Runtime, Viewer } from "./runtime.ts";
import type { Row } from "./data/community.ts";
import { CommunityError } from "./data/community.ts";
import { MediaCard, MediaLibrary } from "./media-view.tsx";
import { MediaPicker } from "./settings-view.tsx";
import { uploadMedia } from "./media.ts";
import { wantsJSON } from "./http.ts";

export const mediaRoutes = route({
  library: get("/settings/media"),
  upload: post("/settings/media/upload"),
  rename: post("/settings/media/:id/rename"),
  alt: post("/settings/media/:id/alt"),
  remove: post("/settings/media/:id/delete"),
  quickUpload: post("/api/media/quick-upload"),
});
const redirect = (location = "/settings/media") =>
  new Response(null, { status: 303, headers: { Location: location } });
const fragment = async (body: RemixNode) =>
  new Response(await renderToString(body), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

async function card(request: Request, item: Row) {
  if (wantsJSON(request)) return Response.json(item);
  if (request.headers.get("HX-Request") === "true")
    return fragment(<MediaCard item={item} />);
  return redirect();
}

export function mediaController(
  env: Bindings,
  store: Runtime,
  viewer: Viewer,
  page: (title: string, body: RemixNode) => Promise<Response>,
) {
  return createController(mediaRoutes, {
    actions: {
      async library({ request }) {
        if (!viewer.member) return redirect("/login");
        const data = await store.call("media", viewer.member.id);
        if (wantsJSON(request)) return Response.json(data);
        return page(
          "media settings",
          <MediaLibrary
            {...data}
            error={new URL(request.url).searchParams.get("error") ?? undefined}
          />,
        );
      },
      async upload({ request }) {
        if (!viewer.member) return redirect("/login");
        try {
          return card(
            request,
            await uploadMedia(request, env, store, viewer.member),
          );
        } catch (error) {
          if (
            !(error instanceof CommunityError) ||
            ![413, 409].includes(error.status) ||
            (error.status === 409 && !error.message.includes("storage"))
          )
            throw error;
          const tooBig = error.status === 413;
          if (wantsJSON(request))
            return Response.json(
              { ok: false, error: tooBig ? "file too big" : "storage full" },
              { status: 400 },
            );
          return redirect(
            `/settings/media?error=${tooBig ? "too_big" : "storage_full"}`,
          );
        }
      },
      async rename({ request, params }) {
        if (!viewer.member) return redirect("/login");
        const body = await request.formData();
        if (!body.has("filename"))
          throw new CommunityError(422, "Filename is required");
        await store.renameMedia(
          viewer.member.id,
          Number(params.id),
          String(body.get("filename")),
        );
        return card(
          request,
          await store.call("mediaItem", viewer.member.id, Number(params.id)),
        );
      },
      async alt({ request, params }) {
        if (!viewer.member) return redirect("/login");
        const body = await request.formData();
        return card(
          request,
          await store.call(
            "saveMediaAlt",
            viewer.member.id,
            Number(params.id),
            String(body.get("alt_text") ?? ""),
          ),
        );
      },
      async remove({ request, params }) {
        if (!viewer.member) return redirect("/login");
        await store.removeMedia(viewer.member.id, Number(params.id));
        if (wantsJSON(request))
          return Response.json({ ok: true, message: "deleted" });
        if (request.headers.get("HX-Request") === "true") return fragment("");
        return redirect();
      },
      async quickUpload({ request }) {
        if (!viewer.member)
          throw new CommunityError(401, "Sign in to continue");
        const form = await request.clone().formData();
        let item: Row;
        try {
          item = await uploadMedia(request, env, store, viewer.member);
        } catch (error) {
          if (
            !(error instanceof CommunityError) ||
            ![409, 413].includes(error.status) ||
            (error.status === 409 && !error.message.includes("storage"))
          )
            throw error;
          return new Response(
            `<p class="error">${error.status === 413 ? "file too big (max 10 MB)" : "storage limit reached"}</p>`,
            {
              status: 400,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            },
          );
        }
        return fragment(
          <MediaPicker
            items={(await store.call("media", viewer.member.id)).items}
            editor={String(form.get("picker_textarea_id") ?? "")}
            format={String(form.get("picker_format") ?? "html")}
            selected={String(item.storage_path)}
          />,
        );
      },
    },
  });
}
