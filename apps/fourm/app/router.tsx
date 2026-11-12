import { createRouter, createController } from "remix/router";
import { get, post, put, del, route } from "remix/routes";
import { renderToString } from "remix/component/server";
import { unsafeHTML } from "remix/component";
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
import { content } from "./rendering.ts";
import { chatStream } from "./chat.ts";
import { PublicCards } from "./widgets.tsx";
import { widgetRoutes, widgetController } from "./widgets-controller.tsx";
import { archiveObject, restoreArchive } from "./archive.ts";
import {
  Document,
  BareDocument,
  rawPage,
  Members,
  Profile,
  Settings,
  PageEditor,
  Forum,
  NewThread,
  Thread,
  Chat,
  Media,
  Invites,
} from "./views.tsx";

const routes = route({
  home: get("/"),
  login: get("/auth/start"),
  loginAlias: get("/login"),
  callback: get("/auth/callback"),
  logout: post("/logout"),
  profile: get("/u/:username"),
  page: get("/u/:username/page/*slug"),
  shortPage: get("/u/:username/p/*slug"),
  settings: get("/settings"),
  saveSettings: post("/settings"),
  newPage: get("/settings/pages/new"),
  editPage: get("/settings/pages/*slug"),
  createPage: post("/settings/pages/new"),
  savePage: post("/settings/pages/*slug"),
  deletePage: post("/settings/pages/*slug/delete"),
  forum: get("/forum"),
  newThread: get("/forum/new"),
  createThread: post("/forum"),
  thread: get("/forum/:id"),
  reply: post("/forum/:id/reply"),
  moderate: post("/forum/:id/moderate"),
  chat: get("/chat"),
  sendChat: post("/chat"),
  chatMessages: get("/chat/messages"),
  chatStream: get("/chat/stream"),
  config: get("/api/v1/auth-config"),
  me: get("/api/v1/me"),
  pages: get("/api/v1/pages"),
  getPage: get("/api/v1/pages/*slug"),
  publishPage: put("/api/v1/pages/*slug"),
  removePage: del("/api/v1/pages/*slug"),
  restore: post("/api/archive"),
  exportArchive: get("/api/archive"),
  restoreObject: put("/api/archive/media/*path"),
  media: get("/settings/media"),
  upload: post("/settings/media/upload"),
  deleteMedia: post("/settings/media/:id/delete"),
  bytes: get("/uploads/:username/*filename"),
  apiMedia: get("/api/v1/media"),
  apiUpload: post("/api/v1/media"),
  apiDeleteMedia: del("/api/v1/media/:id"),
  invites: get("/settings/invites"),
  createInvite: post("/settings/invites"),
  disableInvite: post("/settings/invites/:id/disable"),
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
  async function page(title: string, body: RemixNode) {
    return new Response(
      "<!doctype html>" +
        (await renderToString(
          <Document title={title} member={viewer.member}>
            {body}
          </Document>,
        )),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  async function memberPage(
    title: string,
    record: Row,
    profile: Row,
    body: RemixNode,
  ) {
    if (record.layout === "raw")
      return new Response(rawPage(record, profile), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    if (record.layout === "cssonly")
      return new Response(
        "<!doctype html>" +
          (await renderToString(
            <BareDocument title={title}>{body}</BareDocument>,
          )),
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    return page(title, body);
  }

  async function apiMember(request: Request, permission?: string) {
    const principal = await bearer(request, env, permission);
    return store.call("resolveIdentity", env.AUTH_ISSUER, principal.subject);
  }
  async function savePage(request: Request) {
    const actor = member();
    const body = await fields(request);
    await store.call("savePage", actor.id, String(body.slug), body);
    return redirect("/settings");
  }
  const router = createRouter();
  router.map(widgetRoutes, widgetController(env, store, viewer, page));
  router.map(
    routes,
    createController(routes, {
      actions: {
        async admin() {
          const users = await store.call("adminMembers", member().id);
          return page(
            "Admin",
            <>
              <h1>Admin</h1>
              <h2>Members</h2>
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr>
                      <td>
                        {user.display_name} (@{user.username})
                      </td>
                      <td>{user.is_admin ? "admin" : "member"}</td>
                      <td>
                        <form
                          method="post"
                          action={`/admin/users/${user.id}/disabled`}
                        >
                          <input
                            type="hidden"
                            name="disabled"
                            value={user.is_disabled ? "0" : "1"}
                          />
                          <button>
                            {user.is_disabled ? "Enable" : "Disable"}{" "}
                            {user.username}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            "Edit post",
            <>
              <h1>Edit post</h1>
              <form method="post">
                <label htmlFor="content">Content</label>
                <textarea
                  id="content"
                  name="content"
                  required
                  defaultValue={String(item.content)}
                />
                <label>
                  Format
                  <select name="content_format" aria-label="Format">
                    <option
                      value="bbcode"
                      selected={item.content_format === "bbcode"}
                    >
                      BBCode
                    </option>
                    <option
                      value="markdown"
                      selected={item.content_format === "markdown"}
                    >
                      Markdown
                    </option>
                    <option
                      value="html"
                      selected={item.content_format === "html"}
                    >
                      HTML
                    </option>
                  </select>
                </label>
                <button>Save post</button>
              </form>
              <form method="post" action={`/forum/posts/${item.id}/delete`}>
                <button>Delete post</button>
              </form>
            </>,
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
          return redirect(`/forum/${item.thread_id}`);
        },
        async deletePost({ params }) {
          const thread = await store.call(
            "deletePost",
            member().id,
            Number(params.id),
          );
          return redirect(thread ? `/forum/${thread}` : "/forum");
        },
        async home() {
          return page(
            "Home",
            <>
              <Members members={await store.call("members")} />
              <PublicCards cards={await store.call("publicCards")} />
            </>,
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
          const profile = await store.call("profile", params.username);
          return memberPage(
            String(profile.display_name),
            profile,
            profile,
            <Profile
              profile={profile}
              pages={await store.call(
                "pages",
                Number(profile.id),
                viewer.member?.id ?? null,
              )}
            />,
          );
        },
        async page({ params }) {
          const profile = await store.call("profile", params.username);
          const item = await store.call(
            "page",
            Number(profile.id),
            params.slug,
            viewer.member?.id ?? null,
          );
          return memberPage(
            String(item.title),
            item,
            profile,
            <>
              <h1>{item.title}</h1>
              <article
                innerHTML={unsafeHTML(
                  content(String(item.content), String(item.content_format)),
                )}
              />
            </>,
          );
        },
        shortPage({ params }) {
          return redirect(
            `/u/${encodeURIComponent(params.username)}/page/${encodeURIComponent(params.slug)}`,
          );
        },
        async settings() {
          const actor = member();
          return page(
            "Settings",
            <Settings
              member={actor}
              profile={await store.call("profile", actor.username)}
              pages={await store.call("pages", actor.id, actor.id)}
            />,
          );
        },
        async saveSettings({ request }) {
          await store.call("saveProfile", member().id, await fields(request));
          return redirect("/settings");
        },
        newPage() {
          member();
          return page("Create a page", <PageEditor />);
        },
        async editPage({ params }) {
          const actor = member();
          return page(
            "Edit page",
            <PageEditor
              page={await store.call("page", actor.id, params.slug, actor.id)}
            />,
          );
        },
        createPage({ request }) {
          return savePage(request);
        },
        savePage({ request }) {
          return savePage(request);
        },
        async deletePage({ params }) {
          await store.call("deletePage", member().id, params.slug);
          return redirect("/settings");
        },
        async forum() {
          return page(
            "Forum",
            <Forum
              threads={await store.call("threads")}
              member={viewer.member}
            />,
          );
        },
        newThread() {
          member();
          return page("New thread", <NewThread />);
        },
        async createThread({ request }) {
          const body = await fields(request);
          const id = await store.call(
            "createThread",
            member().id,
            String(body.title ?? ""),
            String(body.content ?? ""),
            String(body.content_format ?? "bbcode"),
          );
          return redirect(`/forum/${id}`);
        },
        async thread({ params }) {
          const result = await store.call("thread", Number(params.id));
          return page(
            String(result.thread.title),
            <Thread {...result} member={viewer.member} />,
          );
        },
        async reply({ request, params }) {
          const body = await fields(request);
          await store.call(
            "reply",
            member().id,
            Number(params.id),
            String(body.content ?? ""),
            String(body.content_format ?? "bbcode"),
          );
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
            "Chat",
            <Chat messages={await store.call("recentChat", member().id)} />,
          );
        },
        async sendChat({ request }) {
          const body = await fields(request);
          await store.call("sendChat", member().id, String(body.message ?? ""));
          if (request.headers.get("Accept")?.includes("application/json"))
            return Response.json({ ok: true });
          return redirect("/chat");
        },
        chatStream({ request }) {
          return chatStream(request, store, member().id);
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
        async exportArchive({ request }) {
          const actor = await apiMember(request, "archive-read");
          return Response.json({
            version: 1,
            tables: await store.call("exportArchive", actor.id),
          });
        },
        async media() {
          return page(
            "Media library",
            <Media {...await store.call("media", member().id)} />,
          );
        },
        async upload({ request }) {
          await uploadMedia(request, env, store, member());
          return redirect("/settings/media");
        },
        async deleteMedia({ params }) {
          await store.call("deleteMedia", member().id, Number(params.id));
          return redirect("/settings/media");
        },
        bytes({ params }) {
          return readMedia(env, store, `${params.username}/${params.filename}`);
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
          await store.call(
            "deleteMedia",
            (await apiMember(request, "media-write")).id,
            Number(params.id),
          );
          return Response.json({ ok: true, message: "media deleted" });
        },
        async invites() {
          return page(
            "Invites",
            <Invites
              invites={await store.call("invites", member().id)}
              origin={env.AUTH_PUBLIC_ORIGIN}
            />,
          );
        },
        async createInvite({ request }) {
          const body = await fields(request);
          await store.call(
            "createInvite",
            member().id,
            crypto.randomUUID().replace(/-/g, ""),
            Number(body.max_uses),
          );
          return redirect("/settings/invites");
        },
        async disableInvite({ params }) {
          await store.call("disableInvite", member().id, Number(params.id));
          return redirect("/settings/invites");
        },
        register({ request }) {
          return page(
            "Join 4orm",
            <>
              <h1>Join 4orm</h1>
              <p>
                Use a member's invite. Account creation and verification
                continue at Jack Auth.
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
                <button>Continue to Jack Auth</button>
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
