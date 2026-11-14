import { AdminBackups } from "./admin-backups.tsx";
import { AdminStorage } from "./admin-storage.tsx";
import { AdminForum } from "./admin-forum.tsx";
import { AdminUsers } from "./admin-users.tsx";
import { AdminEditors } from "./admin-editors.tsx";
import { adminRoutes, adminController } from "./admin-controller.tsx";
import { AdminBanner } from "./admin-banner.tsx";
import { exportUserSite, exportFullSite } from "./site-export.ts";
import { deliverPush } from "./push-delivery.ts";
import { pushRoutes, pushController } from "./push-controller.tsx";
import { mediaRoutes, mediaController } from "./media-controller.tsx";
import { wantsJSON } from "./http.ts";
import { threadJSON, forumJSON, settingsJSON, homeJSON } from "./view-json.ts";
import howToHTML from "./help/how_to.ts";
import cliHTML from "./help/cli.ts";
import designHTML from "./help/design.ts";
import { profileBody, pageBody, rawMemberPage } from "./member-pages.tsx";
import { createRouter, createController } from "remix/router";
import { get, post, put, del, route } from "remix/routes";
import { renderToString } from "remix/component/server";
import type { RemixNode } from "remix/component";
import {
  PROJECT_ROLES_SCOPE,
  projectAudienceScope,
  roleScope,
} from "@harrhy/identity";
import { CommunityError } from "./data/community.ts";
import type { Row } from "./data/community.ts";
import type { Bindings, Runtime, Viewer } from "./runtime.ts";
import { cookie } from "./runtime.ts";
import { startLogin, finishLogin, bearer } from "./auth.ts";
import { uploadMedia, readMedia } from "./media.ts";
import { apiPage, pageWrite } from "./api-contract.ts";
import {
  register,
  delivery,
  enrollmentService,
  enrollmentState,
  serviceBody,
} from "./enrollment.ts";
import { readCookie } from "./runtime.ts";
import { postContent } from "./rendering.ts";
import { chatStream } from "./chat.ts";
import { Settings, InvitesSettings, PagesList } from "./settings-view.tsx";
import { settingsRoutes, settingsController } from "./settings-controller.tsx";
import { Home } from "./home.tsx";
import { widgetRoutes, widgetController } from "./widgets-controller.tsx";
import {
  archiveObject,
  restoreArchive,
  archiveMediaMetadata,
} from "./archive.ts";
import { ForumEditor } from "./forum-editor.tsx";
import { Document, Forum, ThreadHeader, Thread, Chat } from "./views.tsx";

const routes = route({
  home: get("/"),
  howTo: get("/how-to"),
  cli: get("/cli"),
  design: get("/design"),
  download: get("/cli/download/:target"),
  login: get("/auth/start"),
  loginAlias: get("/login"),
  callback: get("/auth/callback"),
  logout: post("/logout"),
  profile: get("/u/:username"),
  exportSite: get("/u/:username/export"),
  exportFullSite: get("/admin/export"),
  page: get("/u/:username/page/*slug"),
  shortPage: get("/u/:username/p/*slug"),
  settings: get("/settings"),
  saveSettings: post("/settings"),
  deletePage: post("/settings/pages/*slug/delete"),
  forum: get("/forum"),
  newThread: get("/forum/new"),
  previewPost: post("/forum/preview"),
  createThread: post("/forum/new"),
  thread: get("/forum/:id"),
  reply: post("/forum/:id/reply"),
  watchThread: post("/forum/:id/watch"),
  editThread: get("/forum/:id/edit"),
  saveThread: post("/forum/:id/edit"),
  pinThread: post("/forum/:id/pin"),
  lockThread: post("/forum/:id/lock"),
  deleteThread: post("/forum/:id/delete"),
  moderate: post("/forum/:id/moderate"),
  chat: get("/chat"),
  sendChat: post("/chat"),
  chatMessages: get("/chat/messages"),
  chatStream: get("/chat/stream"),
  chatPresence: post("/chat/presence"),
  config: get("/api/v1/auth-config"),
  me: get("/api/v1/me"),
  pages: get("/api/v1/pages"),
  getPage: get("/api/v1/pages/*slug"),
  publishPage: put("/api/v1/pages/*slug"),
  removePage: del("/api/v1/pages/*slug"),
  restore: post("/api/archive"),
  exportArchive: get("/api/archive"),
  restoreObject: put("/api/archive/media/*path"),
  bytes: get("/uploads/:username/*filename"),
  apiMedia: get("/api/v1/media"),
  apiUpload: post("/api/v1/media"),
  apiDeleteMedia: del("/api/v1/media/:id"),
  invites: get("/settings/invites"),
  createInvite: post("/settings/invites"),
  disableInvite: post("/settings/invites/:id/disable"),
  deleteInvite: post("/settings/invites/:id/delete"),
  register: get("/register"),
  enroll: post("/auth/register"),
  pendingEnrollment: get("/internal/auth/enrollments/:id"),
  claimEnrollment: post("/internal/auth/enrollments/:id/claim"),
  trust: get("/trust-agreement"),
  acceptTrust: post("/trust-agreement"),
  completion: get("/internal/auth/enrollments/:id/completion"),
  reserveGrant: post(
    "/internal/auth/enrollments/:id/completion/:application/reserve",
  ),
  finishGrant: post(
    "/internal/auth/enrollments/:id/completion/:application/finish",
  ),
  retryCompletions: post("/admin/enrollment-completions/retry"),
  admin: get("/admin"),
  disableMember: post("/admin/users/:id/disabled"),
  editPost: get("/forum/posts/:id/edit"),
  savePost: post("/forum/posts/:id/edit"),
  deletePost: post("/forum/posts/:id/delete"),
});
const redirect = (Location: string) =>
  new Response(null, { status: 303, headers: { Location } });

async function fields(request: Request): Promise<Row> {
  const form = await request.formData();
  return Object.fromEntries(
    Array.from(form.entries()).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function createAppRouter(
  env: Bindings,
  store: Runtime,
  viewer: Viewer,
  background: (operation: Promise<unknown>) => void,
) {
  function member() {
    if (!viewer.member) throw new CommunityError(401, "Sign in to continue");
    return viewer.member;
  }
  async function page(
    title: string,
    body: RemixNode,
    html?: string,
    banner: Row | null = null,
  ) {
    return new Response(
      "<!doctype html>" +
        (await renderToString(
          <Document
            title={title}
            vapidKey={env.VAPID_PUBLIC_KEY}
            member={viewer.member}
            banner={banner}
            html={html}
          >
            {body}
          </Document>,
        )),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  async function httpError(request: Request, status: number, message: string) {
    if (wantsJSON(request))
      return Response.json(
        { ok: false, error: message, status_code: status },
        { status },
      );
    const response = await page(
      `4orm · ${status}`,
      <section class="panel">
        <h1>{status}</h1>
        <p>{message}</p>
        <p>
          <a href="/">← back to home</a>
        </p>
      </section>,
    );
    return new Response(response.body, { status, headers: response.headers });
  }
  async function forumPost(request: Request, write: () => Promise<number>) {
    try {
      return await write();
    } catch (error) {
      if (
        !(error instanceof CommunityError) ||
        error.status !== 429 ||
        !error.retryAfter
      )
        throw error;
      if (wantsJSON(request))
        return Response.json({ ok: false, error: error.message });
      if (request.headers.get("HX-Request") === "true")
        return new Response(
          `<p class="error">please wait ${error.retryAfter} seconds before posting again</p>`,
          {
            status: 429,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      return httpError(request, 429, error.message);
    }
  }

  async function apiMember(request: Request, permission?: string) {
    const principal = await bearer(request, env, permission);
    return store.call("resolveIdentity", env.AUTH_ISSUER, principal.subject);
  }
  const router = createRouter();
  router.map(adminRoutes, adminController(store, viewer, env));
  router.map(pushRoutes, pushController(store, viewer));
  router.map(settingsRoutes, settingsController(store, viewer, page));
  router.map(mediaRoutes, mediaController(env, store, viewer, page));
  router.map(
    widgetRoutes,
    widgetController(env, store, viewer, page, background),
  );
  router.map(
    routes,
    createController(routes, {
      actions: {
        async admin({ request }) {
          const snapshot = await store.call(
            "adminSnapshot",
            viewer.member?.id ?? null,
          );
          const users = snapshot.users;
          const notice = new URL(request.url).searchParams;
          return page(
            "admin",
            <>
              <h1>admin</h1>
              {notice.get("cleaned_files") ? (
                <p class="ok">
                  removed {notice.get("cleaned_files")} orphaned file(s) from
                  disk.
                </p>
              ) : null}
              {notice.get("cleaned_records") ? (
                <p class="ok">
                  removed {notice.get("cleaned_records")} orphaned record(s)
                  from database.
                </p>
              ) : null}
              {notice.get("randomized_cards") ? (
                <p class="ok">
                  randomized colors for {notice.get("randomized_cards")} default
                  card(s).
                </p>
              ) : null}
              <AdminBanner banner={snapshot.banner} />
              <AdminUsers users={users} storage={snapshot.storage} />
              <AdminEditors
                users={users}
                cards={snapshot.cards}
                pages={snapshot.pages}
              />
              <AdminForum threads={snapshot.threads} posts={snapshot.posts} />
              <AdminBackups
                {...await store.call("backupStatus", viewer.member?.id ?? null)}
              />
              <AdminStorage />
              <form method="post" action="/admin/enrollment-completions/retry">
                <button>Retry pending enrollment delivery</button>
              </form>
            </>,
          );
        },
        async disableMember({ request, params }) {
          const body = await fields(request);
          await store.call(
            "setDisabled",
            member().id,
            Number(params.id),
            body.disabled === "1",
          );
          return redirect("/admin");
        },
        async editPost({ params }) {
          const item = await store.call(
            "postForEdit",
            member().id,
            Number(params.id),
          );
          return page(
            "4orm · edit post",
            <ForumEditor
              post={item}
              media={(await store.call("media", member().id)).items}
            />,
          );
        },
        async savePost({ request, params }) {
          const item = await store.call(
            "postForEdit",
            member().id,
            Number(params.id),
          );
          const body = await fields(request);
          await store.call(
            "editPost",
            member().id,
            Number(params.id),
            String(body.content ?? ""),
            String(body.content_format ?? "bbcode"),
          );
          if (wantsJSON(request))
            return Response.json({ ok: true, message: "post updated" });
          return redirect(`/forum/${item.thread_id}`);
        },
        async deletePost({ request, params }) {
          const thread = await store.call(
            "deletePost",
            member().id,
            Number(params.id),
          );
          if (wantsJSON(request))
            return Response.json({ ok: true, message: "post deleted" });
          if (request.headers.get("HX-Request") === "true")
            return new Response("");
          return redirect(thread ? `/forum/${thread}` : "/forum");
        },
        howTo() {
          return page("how-to", null, howToHTML);
        },
        cli() {
          return page("4orm cli", null, cliHTML);
        },
        design() {
          return page("design - 4orm", null, designHTML);
        },
        download({ params }) {
          const targets: Record<string, string> = {
            "macos-arm64": "4orm-darwin-arm64.tar.gz",
            "macos-amd64": "4orm-darwin-amd64.tar.gz",
            "linux-arm64": "4orm-linux-arm64.tar.gz",
            "linux-amd64": "4orm-linux-amd64.tar.gz",
            "windows-arm64": "4orm-windows-arm64.zip",
            "windows-amd64": "4orm-windows-amd64.zip",
          };
          if (!Object.hasOwn(targets, params.target))
            throw new CommunityError(404, "Not found");
          return new Response(null, {
            status: 302,
            headers: {
              Location:
                "https://github.com/jackharrhy/4orm/releases/latest/download/" +
                targets[params.target],
            },
          });
        },
        async home({ request }) {
          const home = await store.call("home");
          if (wantsJSON(request)) return Response.json(homeJSON(home));
          return page(
            "4orm · home",
            <Home {...home} />,
            undefined,
            await store.call("siteBanner"),
          );
        },
        login({ request }) {
          return startLogin(
            env,
            store,
            new URL(request.url).searchParams.get("next") === "register"
              ? readCookie(request, "fourm_enrollment")
              : null,
          );
        },
        loginAlias() {
          return redirect("/auth/start");
        },
        callback({ request }) {
          return finishLogin(request, env, store, (id) =>
            background(delivery(id, env, store)),
          );
        },
        async logout() {
          if (viewer.sessionHash)
            await store.call("endSession", viewer.sessionHash);
          return new Response(null, {
            status: 303,
            headers: {
              Location: "/",
              "Set-Cookie": cookie(env, "fourm_session", "", 0),
            },
          });
        },
        async profile({ params }) {
          const { profile, pages } = await store.call(
            "publicProfile",
            params.username,
          );
          if (profile.layout === "raw")
            return new Response(
              rawMemberPage(profile, profile, {
                username: profile.username,
                display_name: profile.display_name,
                pages: pages.map((item) => ({
                  slug: item.slug,
                  title: item.title,
                })),
                lineage_url: `/lineage#user-${profile.username}`,
              }),
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            );
          return page(
            String(profile.display_name),
            null,
            await profileBody(profile, pages),
          );
        },
        async page({ params }) {
          const profile = await store.call("profile", params.username),
            record = await store.call(
              "page",
              Number(profile.id),
              params.slug,
              null,
            );
          if (record.layout === "raw")
            return new Response(rawMemberPage(record, profile), {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          return page(
            String(record.title),
            null,
            await pageBody(record, profile),
          );
        },
        shortPage({ params }) {
          return redirect(
            `/u/${encodeURIComponent(params.username)}/page/${encodeURIComponent(params.slug)}`,
          );
        },
        async settings({ request }) {
          const snapshot = await store.call("settingsSnapshot", member().id);
          if (wantsJSON(request)) return Response.json(settingsJSON(snapshot));
          const query = new URL(request.url).searchParams;
          return page(
            "settings",
            <Settings
              {...snapshot}
              newInvite={query.get("new_invite") ?? undefined}
              error={query.get("error") ?? undefined}
            />,
            undefined,
            await store.call("siteBanner"),
          );
        },
        async saveSettings({ request }) {
          await store.call("saveProfile", member().id, await fields(request));
          return redirect("/settings");
        },
        async deletePage({ request, params }) {
          const user = member();
          await store.call("deletePage", user.id, params.slug);
          if (wantsJSON(request))
            return Response.json({ ok: true, message: "page deleted" });
          if (request.headers.get("HX-Request") === "true")
            return new Response(
              await renderToString(
                <PagesList
                  pages={await store.call("pages", user.id, user.id)}
                  username={user.username}
                />,
              ),
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            );
          return redirect("/settings");
        },
        async forum({ request }) {
          const raw = new URL(request.url).searchParams.get("page") ?? "1";
          if (!/^[+-]?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
            throw new CommunityError(422, "Invalid page number");
          const index = await store.call("forumIndex", Number(raw));
          if (wantsJSON(request)) return Response.json(forumJSON(index));
          return page(
            "4orm · forum",
            <Forum {...index} member={viewer.member} />,
            undefined,
            await store.call("siteBanner"),
          );
        },
        async previewPost({ request }) {
          const body = await fields(request);
          const rendered = postContent(
            String(body.content ?? ""),
            String(body.content_format ?? "bbcode"),
          );
          return new Response(
            rendered.trim()
              ? `<div class="forum-post-content">${rendered}</div>`
              : '<p class="muted">nothing to preview</p>',
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        },
        async newThread() {
          return page(
            "4orm · new thread",
            <ForumEditor
              media={(await store.call("media", member().id)).items}
            />,
          );
        },
        async createThread({ request }) {
          const body = await fields(request);
          const id = await forumPost(request, () =>
            store.call(
              "createThread",
              member().id,
              String(body.title ?? ""),
              String(body.content ?? ""),
              String(body.content_format ?? "bbcode"),
              body,
            ),
          );
          if (id instanceof Response) return id;
          if (wantsJSON(request))
            return Response.json({
              ok: true,
              id,
              slug: null,
              code: null,
              redirect: `/forum/${id}`,
            });
          return redirect(`/forum/${id}`);
        },
        async thread({ request, params }) {
          const raw = new URL(request.url).searchParams.get("page") ?? "1";
          if (!/^[+-]?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
            throw new CommunityError(422, "Invalid page number");
          const result = await store.call(
            "thread",
            Number(params.id),
            Number(raw),
            viewer.member?.id ?? null,
          );
          if (wantsJSON(request)) return Response.json(threadJSON(result));
          const props = {
            ...result,
            member: viewer.member,
            media: viewer.member
              ? (await store.call("media", viewer.member.id)).items
              : [],
          };
          const html =
            (await renderToString(<ThreadHeader {...props} />)) +
            "\n" +
            String(result.thread.custom_html ?? "") +
            "\n" +
            (await renderToString(<Thread {...props} />));
          return page("4orm · " + result.thread.title, null, html);
        },
        async reply({ request, params }) {
          const body = await fields(request);
          if (body.quoted_post_id && !/^\d+$/.test(String(body.quoted_post_id)))
            throw new CommunityError(422, "Invalid quoted post ID");
          const id = await forumPost(request, () =>
            store.call(
              "reply",
              member().id,
              Number(params.id),
              String(body.content ?? ""),
              String(body.content_format ?? "bbcode"),
              body,
            ),
          );
          if (id instanceof Response) return id;
          if (env.VAPID_PRIVATE_KEY)
            background(
              store
                .call("replyNotifications", member().id, id)
                .then((items) => deliverPush(env, store, items)),
            );
          const detail = await store.call("thread", Number(params.id));
          const target = `/forum/${params.id}?page=${detail.total_pages}`;
          if (wantsJSON(request))
            return Response.json({
              ok: true,
              id,
              slug: null,
              code: null,
              redirect: target,
            });
          if (request.headers.get("HX-Request") === "true")
            return new Response("", { headers: { "HX-Redirect": target } });
          return redirect(target);
        },
        async editThread({ params }) {
          const thread = await store.call(
            "threadForEdit",
            member().id,
            Number(params.id),
          );
          return page(
            "4orm · edit thread",
            <>
              <h1>edit thread</h1>
              <form
                method="post"
                action={`/forum/${thread.id}/edit`}
                class="stack"
              >
                <label>
                  title
                  <input
                    type="text"
                    name="title"
                    required
                    maxLength={200}
                    value={String(thread.title)}
                  />
                </label>
                <label>
                  custom CSS
                  <textarea
                    name="custom_css"
                    rows={4}
                    value={String(thread.custom_css ?? "")}
                  />
                </label>
                <label>
                  custom HTML
                  <textarea
                    name="custom_html"
                    rows={4}
                    value={String(thread.custom_html ?? "")}
                  />
                </label>
                <button type="submit">save</button>
              </form>
              <p class="fourm-space-sm">
                <a href={`/forum/${thread.id}`}>back to thread</a>
              </p>
            </>,
          );
        },
        async saveThread({ request, params }) {
          await store.call(
            "editThread",
            member().id,
            Number(params.id),
            await fields(request),
          );
          if (wantsJSON(request))
            return Response.json({ ok: true, message: "thread updated" });
          return redirect(`/forum/${params.id}`);
        },
        async pinThread({ request, params }) {
          await store.call("moderate", member().id, Number(params.id), "pin");
          if (wantsJSON(request))
            return Response.json({ ok: true, message: "pin toggled" });
          if (request.headers.get("HX-Request") === "true")
            return new Response("", { headers: { "HX-Refresh": "true" } });
          return redirect("/forum");
        },
        async lockThread({ request, params }) {
          await store.call("moderate", member().id, Number(params.id), "lock");
          if (wantsJSON(request))
            return Response.json({ ok: true, message: "lock toggled" });
          if (request.headers.get("HX-Request") === "true")
            return new Response("", { headers: { "HX-Refresh": "true" } });
          return redirect(`/forum/${params.id}`);
        },
        async deleteThread({ request, params }) {
          await store.call("deleteThread", member().id, Number(params.id));
          if (wantsJSON(request))
            return Response.json({ ok: true, message: "thread deleted" });
          if (request.headers.get("HX-Request") === "true")
            return new Response("", { headers: { "HX-Redirect": "/forum" } });
          return redirect("/forum");
        },
        async watchThread({ request, params }) {
          const watching = await store.call(
            "toggleThreadWatch",
            member().id,
            Number(params.id),
          );
          if (wantsJSON(request))
            return Response.json({
              ok: true,
              message: watching ? "watching" : "unwatched",
            });
          if (request.headers.get("HX-Request") === "true")
            return new Response("", { headers: { "HX-Refresh": "true" } });
          return redirect(`/forum/${params.id}`);
        },
        async moderate({ request, params }) {
          const body = await fields(request);
          await store.call(
            "moderate",
            member().id,
            Number(params.id),
            String(body.action),
          );
          return redirect(
            body.action === "delete" ? "/forum" : `/forum/${params.id}`,
          );
        },
        async chat() {
          return page(
            "4orm · chat",
            <Chat
              messages={await store.call("chatHistory")}
              member={viewer.member}
            />,
          );
        },
        async sendChat({ request }) {
          const body = await fields(request);
          if (!viewer.member)
            return httpError(
              request,
              403,
              "you don't have permission to access this.",
            );
          const outcome = await store.call(
            "sendChat",
            viewer.member.id,
            String(body.message ?? ""),
          );
          if (request.headers.get("HX-Request") === "true")
            return new Response("");
          if (outcome.status === "timed_out")
            return httpError(request, 429, "Too Many Requests");
          return redirect("/chat");
        },
        chatStream({ request }) {
          return chatStream(request, store, viewer.member?.id ?? null);
        },
        async chatPresence({ request }) {
          const body = (await request.json()) as { active?: unknown };
          await store.call(
            "updateChatPresence",
            viewer.member?.id ?? null,
            body.active === undefined ? true : Boolean(body.active),
          );
          return new Response("");
        },
        async chatMessages({ request }) {
          const after = Number(
            new URL(request.url).searchParams.get("after") ?? 0,
          );
          if (!Number.isSafeInteger(after) || after < 0)
            throw new CommunityError(422, "Invalid message cursor");
          return Response.json({
            messages: await store.call("chat", member().id, after),
          });
        },
        config() {
          return Response.json({
            issuer: env.AUTH_ISSUER,
            client_id: env.AUTH_CLI_CLIENT_ID ?? env.AUTH_CLIENT_ID,
            project_id: env.AUTH_PROJECT_ID,
            scopes: [
              "openid",
              "profile",
              "offline_access",
              projectAudienceScope(env.AUTH_PROJECT_ID),
              PROJECT_ROLES_SCOPE,
              ...[
                "member",
                "pages-read",
                "pages-write",
                "media-read",
                "media-write",
              ].map(roleScope),
            ],
          });
        },
        async me({ request }) {
          const actor = await apiMember(request);
          return Response.json({
            username: actor.username,
            display_name: actor.display_name,
          });
        },
        async pages({ request }) {
          const actor = await apiMember(request, "pages-read");
          return Response.json({
            pages: (await store.call("pages", actor.id, actor.id)).map(apiPage),
          });
        },
        async getPage({ request, params }) {
          const actor = await apiMember(request, "pages-read");
          return Response.json(
            apiPage(await store.call("page", actor.id, params.slug, actor.id)),
          );
        },
        async publishPage({ request, params }) {
          const actor = await apiMember(request, "pages-write");
          const body = pageWrite(await request.json());
          return Response.json(
            apiPage(await store.call("savePage", actor.id, params.slug, body)),
          );
        },
        async removePage({ request, params }) {
          const actor = await apiMember(request, "pages-write");
          await store.call("deletePage", actor.id, params.slug);
          return Response.json({ ok: true, message: "page deleted" });
        },
        restore({ request }) {
          return restoreArchive(request, env, store);
        },
        restoreObject({ request, params }) {
          return archiveObject(request, env, params.path);
        },
        exportFullSite({ request }) {
          return exportFullSite(request, env, store, viewer.member?.id ?? null);
        },
        exportSite({ request, params }) {
          return exportUserSite(
            request,
            env,
            store,
            viewer.member?.id ?? null,
            params.username,
          );
        },
        async exportArchive({ request }) {
          const actor = await apiMember(request, "archive-read");
          const tables = await store.call("exportArchive", actor.id);
          return Response.json({
            version: 1,
            tables,
            objects: await archiveMediaMetadata(env, tables.media),
          });
        },
        bytes({ request, params }) {
          return readMedia(
            request,
            env,
            store,
            `${params.username}/${params.filename}`,
          );
        },
        async apiMedia({ request }) {
          const actor = await apiMember(request, "media-read");
          return Response.json(await store.call("media", actor.id));
        },
        async apiUpload({ request }) {
          return Response.json(
            await uploadMedia(
              request,
              env,
              store,
              await apiMember(request, "media-write"),
            ),
          );
        },
        async apiDeleteMedia({ request, params }) {
          await store.removeMedia(
            (await apiMember(request, "media-write")).id,
            Number(params.id),
          );
          return Response.json({ ok: true, message: "media deleted" });
        },
        invites() {
          return redirect("/settings");
        },
        async createInvite({ request }) {
          const user = member(),
            body = await fields(request),
            code = btoa(
              String.fromCharCode(
                ...crypto.getRandomValues(new Uint8Array(12)),
              ),
            )
              .replaceAll("+", "-")
              .replaceAll("/", "_");
          await store.call(
            "createInvite",
            user.id,
            code,
            Math.max(1, Math.min(50, Number(body.max_uses ?? 1))),
          );
          if (wantsJSON(request))
            return Response.json({
              ok: true,
              id: null,
              slug: null,
              code,
              redirect: null,
            });
          if (request.headers.get("HX-Request") === "true")
            return new Response(
              await renderToString(
                <InvitesSettings
                  invites={await store.call("invites", user.id)}
                />,
              ),
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            );
          return redirect(`/settings?new_invite=${encodeURIComponent(code)}`);
        },
        async disableInvite({ request, params }) {
          await store.call("disableInvite", member().id, Number(params.id));
          if (wantsJSON(request))
            return Response.json({ ok: true, message: "invite disabled" });
          if (request.headers.get("HX-Request") === "true")
            return new Response(
              await renderToString(
                <InvitesSettings
                  invites={await store.call("invites", member().id)}
                />,
              ),
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            );
          return redirect("/settings");
        },
        async deleteInvite({ request, params }) {
          await store.call("deleteInvite", member().id, Number(params.id));
          if (wantsJSON(request))
            return Response.json({ ok: true, message: "invite deleted" });
          if (request.headers.get("HX-Request") === "true")
            return new Response(
              await renderToString(
                <InvitesSettings
                  invites={await store.call("invites", member().id)}
                />,
              ),
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            );
          return redirect("/settings");
        },
        register({ request }) {
          return page(
            "Join 4orm",
            <>
              <h1>Join 4orm</h1>
              <p>
                Use a member's invite. Account creation and verification
                continue on the sign-in service.
              </p>
              <form method="post" action="/auth/register">
                <label>
                  Invite code
                  <input
                    name="invite_code"
                    required
                    value={
                      new URL(request.url).searchParams.get("invite") ?? ""
                    }
                  />
                </label>
                <button>Sign in</button>
              </form>
            </>,
          );
        },
        enroll({ request }) {
          return register(request, env, store);
        },
        trust() {
          member();
          return page(
            "Welcome to 4orm",
            <>
              <h1>Welcome to 4orm</h1>
              <p>
                Members can run custom HTML, CSS, and JavaScript on this site.
                Respect other people's pages and data. Malicious scripts and
                abuse can result in account removal.
              </p>
              <form method="post" action="/trust-agreement">
                <label>
                  <span>
                    <input type="checkbox" name="accept" required /> I agree to
                    use 4orm responsibly.
                  </span>
                </label>
                <button>Continue to 4orm</button>
              </form>
            </>,
          );
        },
        async acceptTrust({ request }) {
          const actor = member();
          const body = await fields(request);
          if (!body.accept)
            throw new CommunityError(422, "Accept the agreement to continue");
          await store.call("acceptTrust", actor.id);
          return redirect(`/u/${actor.username}`);
        },
        async pendingEnrollment({ request, params }) {
          await enrollmentService(request, env);
          return Response.json(
            enrollmentState(await store.call("pendingEnrollment", params.id)),
          );
        },
        async claimEnrollment({ request, params }) {
          await enrollmentService(request, env);
          const body = await serviceBody(request, [
            "subject",
            "username",
            "displayName",
          ]);
          return Response.json(
            enrollmentState(
              await store.call(
                "claimEnrollment",
                params.id,
                env.AUTH_ISSUER,
                body.subject,
                body.username,
                body.displayName,
              ),
            ),
          );
        },
        async completion({ request, params }) {
          await enrollmentService(request, env);
          return Response.json(
            await store.call("completionProof", params.id, env.AUTH_ISSUER),
          );
        },
        async reserveGrant({ request, params }) {
          await enrollmentService(request, env);
          const body = await serviceBody(request, ["subject", "attemptId"]);
          return Response.json(
            await store.call(
              "reserveGrant",
              params.id,
              env.AUTH_ISSUER,
              params.application,
              body.subject,
              body.attemptId,
            ),
          );
        },
        async finishGrant({ request, params }) {
          await enrollmentService(request, env);
          const body = await serviceBody(request, [
            "subject",
            "attemptId",
            "grantId",
            "outcome",
          ]);
          return Response.json(
            await store.call(
              "finishGrant",
              params.id,
              env.AUTH_ISSUER,
              params.application,
              body.subject,
              body.attemptId,
              body.grantId,
              body.outcome,
            ),
          );
        },
        async retryCompletions() {
          if (!member().is_admin)
            throw new CommunityError(403, "Admin access required");
          const pending = await store.call("pendingCompletions");
          const outcomes = [];
          for (const item of pending)
            outcomes.push({
              requestId: item.request_id,
              status: await delivery(String(item.request_id), env, store),
            });
          return Response.json({ outcomes });
        },
      },
    }),
  );
  return router;
}
