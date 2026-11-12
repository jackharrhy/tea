import { createController } from "remix/router";
import { get, post, route } from "remix/routes";
import type { RemixNode } from "remix/component";
import { renderToString } from "remix/component/server";
import { CommunityError } from "./data/community.ts";
import type { Bindings, Runtime, Viewer } from "./runtime.ts";
import { cookie, readCookie, hash, token } from "./runtime.ts";
import { Guestbook, Player, WidgetSettings } from "./widgets.tsx";
import { BareDocument } from "./views.tsx";

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
async function embed(title: string, body: RemixNode) {
  return new Response(
    "<!doctype html>" +
      (await renderToString(<BareDocument title={title}>{body}</BareDocument>)),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export function widgetController(
  env: Bindings,
  store: Runtime,
  viewer: Viewer,
  page: (title: string, body: RemixNode) => Promise<Response>,
) {
  function actor() {
    if (!viewer.member) throw new CommunityError(401, "Sign in to continue");
    return viewer.member;
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
      async settings() {
        const member = actor();
        const [profile, tracks, media, card, ring] = await Promise.all([
          store.call("profile", member.username),
          store.call("playlist", member.username),
          store.call("media", member.id),
          store.call("profileCard", member.id),
          store.call("webring", member.username),
        ]);
        return page(
          "Widgets",
          <WidgetSettings
            profile={profile}
            tracks={tracks}
            media={media.items}
            card={card}
            inWebring={ring.members.some(
              (item) => item.username === member.username,
            )}
          />,
        );
      },
      async statusSave({ request }) {
        const member = actor(),
          body = await fields(request);
        await store.call("saveProfile", member.id, {
          display_name: member.display_name,
          status_text: body.status_text ?? "",
          status_emoji: body.status_emoji ?? "",
        });
        return redirect("/settings/widgets");
      },
      async webringSave({ request }) {
        await store.call(
          "setWebring",
          actor().id,
          (await fields(request)).enabled === "1",
        );
        return redirect("/settings/widgets");
      },
      async avatarSave({ request }) {
        const body = await fields(request);
        await store.call(
          "setAvatar",
          actor().id,
          body.media_id ? Number(body.media_id) : null,
        );
        return redirect("/settings/widgets");
      },
      async cardSave({ request }) {
        await store.call("saveCard", actor().id, await fields(request));
        return redirect("/settings/widgets");
      },
      async addTrack({ request }) {
        const body = await fields(request);
        await store.call(
          "addTrack",
          actor().id,
          Number(body.media_id),
          body.title ?? "",
        );
        return redirect("/settings/widgets");
      },
      async removeTrack({ params }) {
        await store.call("removeTrack", actor().id, Number(params.id));
        return redirect("/settings/widgets");
      },
      async moveTrack({ request, params }) {
        await store.call(
          "moveTrack",
          actor().id,
          Number(params.id),
          (await fields(request)).direction,
        );
        return redirect("/settings/widgets");
      },
      async guestbook({ params }) {
        return new Response(
          "<!doctype html>" +
            (await renderToString(
              <Guestbook
                {...await store.call("guestbook", params.username)}
                member={viewer.member}
              />,
            )),
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      },
      async signGuestbook({ request, params }) {
        await store.call(
          "signGuestbook",
          actor().id,
          params.username,
          (await fields(request)).message ?? "",
        );
        return redirect(`/u/${encodeURIComponent(params.username)}/guestbook`);
      },
      async deleteGuestbook({ params }) {
        await store.call(
          "deleteGuestbook",
          actor().id,
          params.username,
          Number(params.id),
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
        const response = await embed(
          "Visits",
          <p>{result.total_views} visits</p>,
        );
        response.headers.append(
          "Set-Cookie",
          cookie(env, "fourm_visitor", visitor, 365 * 24 * 3600),
        );
        return response;
      },
      async status({ params }) {
        const member = await store.call("status", params.username);
        return embed(
          "Status",
          <p>
            {member.status_emoji} {member.status_text}
          </p>,
        );
      },
      async player({ params }) {
        return embed(
          "Playlist",
          <Player tracks={await store.call("playlist", params.username)} />,
        );
      },
      async webring({ params }) {
        const ring = await store.call("webring", params.username);
        return embed(
          "Webring",
          <nav aria-label="Webring">
            {ring.previous ? (
              <a href={`/u/${ring.previous.username}`}>
                Previous: {ring.previous.display_name}
              </a>
            ) : null}{" "}
            · <a href="/webring/random">Random</a> ·{" "}
            {ring.next ? (
              <a href={`/u/${ring.next.username}`}>
                Next: {ring.next.display_name}
              </a>
            ) : null}
          </nav>,
        );
      },
      async random() {
        const ring = await store.call("webring", "");
        if (!ring.members.length)
          throw new CommunityError(404, "No webring members yet");
        return redirect(
          `/u/${ring.members[Math.floor(Math.random() * ring.members.length)].username}`,
        );
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
