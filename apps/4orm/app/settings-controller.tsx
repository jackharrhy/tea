import { renderToString } from "remix/component/server";
import { wantsJSON } from "./http.ts";
import { createController } from "remix/router";
import { get, post, route } from "remix/routes";
import type { RemixNode } from "remix/component";
import { CommunityError } from "./data/community.ts";
import type { Row } from "./data/community.ts";
import type { Runtime, Viewer } from "./runtime.ts";
import { ContentEditor, LayoutSelect, MediaPicker } from "./settings-view.tsx";

export const settingsRoutes = route({
  profile: post("/settings/profile"),
  username: post("/settings/username"),
  css: post("/settings/css"),
  html: post("/settings/html"),
  guestbook: post("/settings/guestbook"),
  counter: post("/settings/counter"),
  player: post("/settings/player"),
  signature: post("/settings/signature"),
  notifications: post("/settings/notifications"),
  createPage: post("/settings/pages"),
  editPage: get("/settings/pages/*slug/edit"),
  savePage: post("/settings/pages/*slug/edit"),
});
export async function formFields(request: Request): Promise<Row> {
  return Object.fromEntries(
    Array.from((await request.formData()).entries()).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
export function saved(request: Request, url = "/settings") {
  if (wantsJSON(request)) return Response.json({ ok: true, message: "saved" });
  if (request.headers.get("HX-Request") === "true")
    return new Response('<p class="ok htmx-fade">saved.</p>', {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  return new Response(null, { status: 303, headers: { Location: url } });
}
export function settingsController(
  store: Runtime,
  viewer: Viewer,
  page: (title: string, body: RemixNode) => Promise<Response>,
) {
  function actor() {
    if (!viewer.member) throw new CommunityError(401, "Sign in to continue");
    return viewer.member;
  }
  async function section(name: string, request: Request) {
    await store.call(
      "saveSettingsSection",
      actor().id,
      name,
      await formFields(request),
    );
    return saved(request);
  }
  return createController(settingsRoutes, {
    actions: {
      profile: ({ request }) => section("profile", request),
      async username({ request }) {
        if (!viewer.member)
          return new Response(null, {
            status: 303,
            headers: { Location: "/login" },
          });
        const fields = await formFields(request),
          username = String(fields.username ?? "")
            .trim()
            .toLowerCase();
        try {
          await store.renameUsername(viewer.member.id, username);
        } catch (error) {
          if (
            !(error instanceof CommunityError) ||
            ![422, 409].includes(error.status) ||
            (error.status === 409 && !error.message.includes("already taken"))
          )
            throw error;
          if (request.headers.get("HX-Request") === "true")
            return new Response(
              await renderToString(<p class="error">{error.message}</p>),
              {
                status: 400,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              },
            );
          return new Response(null, {
            status: 303,
            headers: {
              Location: `/settings?error=${error.status === 422 ? "invalid_username" : "username_taken"}`,
            },
          });
        }
        return saved(
          request,
          username === viewer.member.username
            ? "/settings"
            : "/settings?saved=username",
        );
      },
      css: ({ request }) => section("css", request),
      html: ({ request }) => section("html", request),
      guestbook: ({ request }) => section("guestbook", request),
      counter: ({ request }) => section("counter", request),
      player: ({ request }) => section("player", request),
      signature: ({ request }) => section("signature", request),
      notifications: ({ request }) => section("notifications", request),
      async createPage({ request }) {
        const user = actor(),
          body = await formFields(request),
          slug = String(body.slug ?? "").trim(),
          title = String(body.title ?? "").trim();
        if (!slug || !title) {
          if (wantsJSON(request))
            return Response.json({
              ok: false,
              error: "a page needs both a slug and a title",
            });
          return new Response(null, {
            status: 303,
            headers: { Location: "/settings?error=missing_page_fields" },
          });
        }
        try {
          await store.call("createSettingsPage", user.id, slug, {
            ...body,
            title,
          });
        } catch (error) {
          if (!(error instanceof CommunityError) || error.status !== 409)
            throw error;
          if (wantsJSON(request))
            return Response.json({
              ok: false,
              error: "a page with that slug already exists",
            });
          return new Response(null, {
            status: 303,
            headers: { Location: "/settings?error=slug_taken" },
          });
        }
        const redirect = `/u/${user.username}/page/${slug}`;
        return wantsJSON(request)
          ? Response.json({ ok: true, id: null, slug, code: null, redirect })
          : new Response(null, {
              status: 303,
              headers: { Location: redirect },
            });
      },
      async editPage({ params }) {
        const user = actor(),
          record = await store.call("page", user.id, params.slug, user.id),
          media = await store.call("media", user.id);
        return page(
          "edit page",
          <>
            <h1>edit page</h1>
            <section class="panel">
              <form
                method="post"
                hx-post=""
                hx-target="#edit-status"
                hx-swap="innerHTML"
                class="stack"
              >
                <label>
                  slug
                  <input name="new_slug" value={String(record.slug)} required />
                </label>
                <label>
                  title
                  <input name="title" value={String(record.title)} required />
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="is_public"
                    checked={Boolean(record.is_public)}
                  />
                  public page
                </label>
                <label>content</label>
                <ContentEditor
                  id="edit_content"
                  value={String(record.content)}
                  format={String(record.content_format)}
                  rows={16}
                />
                <LayoutSelect value={String(record.layout)} />
                <div class="fourm-actions">
                  <button type="submit">save changes</button>
                  <span id="edit-status" />
                </div>
              </form>
            </section>
            {media.items.length ? (
              <section class="panel">
                <h2>media snippets</h2>
                <MediaPicker items={media.items} editor="edit_content" />
              </section>
            ) : null}
            <script type="module" src="/static/codemirror.js" />
          </>,
        );
      },
      async savePage({ request, params }) {
        const user = actor(),
          body = await formFields(request),
          slug = String(body.new_slug ?? "").trim();
        await store.call("editSettingsPage", user.id, params.slug, {
          ...body,
          new_slug: slug,
          is_public: body.is_public === "on" ? 1 : 0,
        });
        return saved(request, `/u/${user.username}/page/${slug}`);
      },
    },
  });
}
