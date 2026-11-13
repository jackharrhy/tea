import { guestbookJSON } from "./view-json.ts";
import { counterJSON, counterDocument } from "./counter-widget.ts";
import { playerJSON, playerDocument } from "./player-widget.ts";
import { webringJSON, webringDocument } from "./webring-widget.ts";
import { statusJSON, statusDocument } from "./status-widget.ts";
import { wantsJSON } from "./http.ts";
import { saved } from "./settings-controller.tsx";
import { PlaylistSettings } from "./settings-view.tsx";
import { createController } from "remix/router";
import { get, post, route } from "remix/routes";
import type { RemixNode } from "remix/component";
import { renderToString } from "remix/component/server";
import { CommunityError } from "./data/community.ts";
import type { Bindings, Runtime, Viewer } from "./runtime.ts";
import { cookie, readCookie, hash, token } from "./runtime.ts";
import { guestbookDocument, GuestbookEntries } from "./widgets.tsx";

export const widgetRoutes = route({
  settings: get("/settings/widgets"),
  statusSave: post("/settings/status"),
  webringSave: post("/settings/webring"),
  cardSave: post("/settings/card"),
  avatarSave: post("/settings/avatar"),
  addTrack: post("/settings/player/add"),
  removeTrack: post("/settings/player/:id/remove"),
  moveTrack: post("/settings/player/:id/move"),
  guestbook: get("/u/:username/guestbook"),
  signGuestbook: post("/u/:username/guestbook"),
  deleteGuestbook: post("/u/:username/guestbook/:id/delete"),
  universe: get("/guestbook-universe"),
  counter: get("/u/:username/counter"),
  status: get("/u/:username/status"),
  player: get("/u/:username/player"),
  webring: get("/u/:username/webring"),
  random: get("/webring/random"),
  lineage: get("/lineage"),
  feed: get("/feed.xml"),
  userFeed: get("/u/:username/feed.xml"),
  forumFeed: get("/forum/feed.xml"),
});
const redirect = (Location: string) =>
  new Response(null, { status: 303, headers: { Location } });
const xml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
async function fields(request: Request) {
  return Object.fromEntries(
    Array.from((await request.formData()).entries()).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function widgetController(
  env: Bindings,
  store: Runtime,
  viewer: Viewer,
  page: (title: string, body: RemixNode) => Promise<Response>,
) {
  function actor(status = 401) {
    if (!viewer.member) throw new CommunityError(status, "Sign in to continue");
    return viewer.member;
  }

  async function playlistResponse(request: Request) {
    if (wantsJSON(request))
      return Response.json({ ok: true, message: "saved" });
    if (request.headers.get("HX-Request") === "true") {
      const user = actor();
      return new Response(
        await renderToString(
          <PlaylistSettings
            tracks={await store.call("playlist", user.username)}
            media={(await store.call("media", user.id)).items}
          />,
        ),
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }
    return redirect("/settings");
  }
  async function rss(username: string | null, forum = false) {
    const rows = forum
      ? await store.call("threads")
      : await store.call("feed", username);
    const items = rows
      .map((row) => {
        const url = forum
          ? `/forum/${row.id}`
          : `/u/${encodeURIComponent(String(row.username))}/page/${encodeURIComponent(String(row.slug))}`;
        return `<item><title>${xml(row.title)}</title><link>${xml(env.AUTH_PUBLIC_ORIGIN + url)}</link><guid>${xml(env.AUTH_PUBLIC_ORIGIN + url)}</guid></item>`;
      })
      .join("");
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>4orm</title><link>${xml(env.AUTH_PUBLIC_ORIGIN)}</link><description>Community updates</description>${items}</channel></rss>`,
      { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
    );
  }
  return createController(widgetRoutes, {
    actions: {
      settings() {
        return redirect("/settings");
      },
      async statusSave({ request }) {
        await store.call(
          "saveSettingsSection",
          actor().id,
          "status",
          await fields(request),
        );
        return saved(request);
      },
      async webringSave({ request }) {
        await store.call(
          "setWebring",
          actor().id,
          (await fields(request)).in_webring === "on",
        );
        return saved(request);
      },
      async avatarSave({ request }) {
        const body = await fields(request);
        await store.call(
          "setAvatar",
          actor().id,
          body.media_id ? Number(body.media_id) : null,
        );
        return redirect("/settings");
      },
      async cardSave({ request }) {
        await store.call("saveCard", actor().id, await fields(request));
        return saved(request);
      },
      async addTrack({ request }) {
        const body = await fields(request);
        await store.call("addTrack", actor().id, Number(body.media_id), null);
        return playlistResponse(request);
      },
      async removeTrack({ request, params }) {
        await store.call("removeTrack", actor().id, Number(params.id));
        return playlistResponse(request);
      },
      async moveTrack({ request, params }) {
        await store.call(
          "moveTrack",
          actor().id,
          Number(params.id),
          (await fields(request)).direction,
        );
        return playlistResponse(request);
      },
      async guestbook({ request, params }) {
        const snapshot = await store.call("guestbook", params.username);
        if (wantsJSON(request))
          return Response.json(guestbookJSON(snapshot, viewer.member !== null));
        return new Response(
          await guestbookDocument({ ...snapshot, member: viewer.member }),
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      },
      async signGuestbook({ request, params }) {
        await store.call(
          "signGuestbook",
          actor(403).id,
          params.username,
          (await fields(request)).message ?? "",
        );
        if (wantsJSON(request))
          return Response.json({ ok: true, message: "entry added" });
        if (request.headers.get("HX-Request") === "true")
          return new Response(
            await renderToString(
              <GuestbookEntries
                {...await store.call("guestbook", params.username)}
                member={viewer.member}
              />,
            ),
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        return redirect(`/u/${encodeURIComponent(params.username)}/guestbook`);
      },
      async deleteGuestbook({ request, params }) {
        await store.call(
          "deleteGuestbook",
          actor(403).id,
          params.username,
          Number(params.id),
        );
        if (wantsJSON(request))
          return Response.json({ ok: true, message: "entry deleted" });
        if (request.headers.get("HX-Request") === "true")
          return new Response(
            await renderToString(
              <GuestbookEntries
                {...await store.call("guestbook", params.username)}
                member={viewer.member}
              />,
            ),
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        return redirect(`/u/${encodeURIComponent(params.username)}/guestbook`);
      },
      async universe() {
        const members = await store.call("members");
        return page(
          "Guestbooks",
          <>
            <h1>Guestbooks</h1>
            <ul>
              {members.map((member) => (
                <li>
                  <a href={`/u/${member.username}/guestbook`}>
                    {member.display_name}'s guestbook
                  </a>
                </li>
              ))}
            </ul>
          </>,
        );
      },
      async counter({ request, params }) {
        const visitor = readCookie(request, "fourm_visitor") ?? token();
        const result = await store.call(
          "counter",
          params.username,
          await hash(visitor),
        );
        const response = wantsJSON(request)
          ? Response.json(counterJSON(result.owner, result.total_views))
          : new Response(counterDocument(result.owner, result.total_views), {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
        response.headers.append(
          "Set-Cookie",
          cookie(env, "fourm_visitor", visitor, 365 * 24 * 3600),
        );
        return response;
      },
      async status({ request, params }) {
        const owner = await store.call("status", params.username);
        if (wantsJSON(request)) return Response.json(statusJSON(owner));
        return new Response(statusDocument(owner), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
      async player({ request, params }) {
        const owner = await store.call("status", params.username);
        const tracks = await store.call("playlist", params.username);
        if (wantsJSON(request))
          return Response.json(playerJSON(params.username, tracks));
        return new Response(playerDocument(owner, tracks), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
      async webring({ request, params }) {
        await store.call("status", params.username);
        const ring = await store.call("webring", params.username);
        if (wantsJSON(request))
          return Response.json(webringJSON(params.username, ring));
        return new Response(webringDocument(ring), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
      async random() {
        const ring = await store.call("webring", "");
        if (!ring.members.length)
          throw new CommunityError(404, "No webring members yet");
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/u/${ring.members[Math.floor(Math.random() * ring.members.length)].username}`,
          },
        });
      },
      async lineage() {
        const members = await store.call("lineage");
        return page(
          "Invite tree",
          <>
            <h1>Invite tree</h1>
            <ul>
              {members.map((member) => (
                <li id={`user-${member.username}`}>
                  <a href={`/u/${member.username}`}>{member.display_name}</a>
                  {member.invited_by_user_id ? (
                    <span>
                      {" "}
                      · invited by{" "}
                      {members.find(
                        (parent) => parent.id === member.invited_by_user_id,
                      )?.display_name ?? "a former member"}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>,
        );
      },
      feed() {
        return rss(null);
      },
      userFeed({ params }) {
        return rss(params.username);
      },
      forumFeed() {
        return rss(null, true);
      },
    },
  });
}
