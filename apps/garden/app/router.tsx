import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter } from "remix/router";
import { render } from "remix/middleware/render";
import { staticFiles } from "remix/middleware/static";
import { createFileResponse } from "remix/response/file";
import { openLazyFile } from "remix/fs";
import type { RemixNode } from "remix/component";
import { assets } from "./assets.ts";
import { routes } from "./routes.ts";
import type { GardenConfig } from "./config.ts";
import { createContentStore } from "./content/store.ts";
import { createMarkdownRenderer } from "./content/markdown.ts";
import { feed } from "./content/rss.ts";
import { page } from "./ui/page.tsx";
import { document } from "./ui/document.tsx";
import { tool } from "./ui/tools.tsx";
import { compare, comparePath, raindropStatus } from "./ui/debug.tsx";
import { readNotes, writeNote } from "./debug-notes.ts";
import { getLinkblogRaindropStatus } from "./content/linkblog-raindrop.ts";

export function createGarden(config: GardenConfig) {
  const content = createContentStore(config.directory);
  let rendering:
    | { revision: number; render: ReturnType<typeof createMarkdownRenderer> }
    | undefined;
  const router = createRouter({
    middleware: [
      staticFiles(fileURLToPath(new URL("../public/", import.meta.url)), {
        index: false,
        cacheControl: config.development ? "no-cache" : "public, max-age=3600",
      }),
      render({ assets }),
    ],
  });
  async function renderPage(
    id: string,
    context: {
      render: (
        node: RemixNode,
        init?: ResponseInit,
      ) => Response | Promise<Response>;
    },
  ) {
    const { entries, byId, index } = content.read();
    const entry = byId.get(id);
    if (!rendering || rendering.revision !== content.revision)
      rendering = {
        revision: content.revision,
        render: createMarkdownRenderer(index),
      };
    const found = entry || byId.get("404");
    if (!found)
      return context.render(
        document({
          ...config,
          title: "Not found",
          children: <h1>Not found</h1>,
        }),
        { status: 404 },
      );
    return context.render(
      await page(found, entries, await rendering.render(found.body), config),
      {
        status: entry && id !== "404" ? 200 : 404,
        headers: {
          "Cache-Control": config.development
            ? "no-store"
            : "public, max-age=60",
        },
      },
    );
  }
  router.get(routes.home, (context) => renderPage("home", context));
  router.get(
    routes.oldHome,
    () => new Response(null, { status: 301, headers: { Location: "/" } }),
  );
  router.get(routes.health, () => {
    const snapshot = content.read();
    return Response.json({ ok: true, pages: snapshot.entries.length });
  });
  router.get(
    routes.assets,
    async ({ request }) =>
      (await assets.fetch(request)) ??
      new Response("Not Found", { status: 404 }),
  );
  router.get(routes.media, async ({ params, request }) => {
    const requested = params.path;
    if (
      !requested ||
      requested.includes("\\") ||
      requested.split("/").some((part) => part === ".." || part.startsWith("."))
    )
      return new Response("Invalid path", { status: 400 });
    if (!config.development)
      return Response.redirect(
        `${config.assetOrigin}/${requested.split("/").map(encodeURIComponent).join("/")}`,
        302,
      );
    try {
      const root = await fs.realpath(config.assetsDirectory);
      const target = await fs.realpath(path.resolve(root, requested));
      if (!target.startsWith(root + path.sep))
        return new Response("Invalid path", { status: 400 });
      return createFileResponse(openLazyFile(target), request, {
        cacheControl: "no-cache",
      });
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      )
        return new Response("Not found", { status: 404 });
      throw error;
    }
  });
  router.get(routes.feed, async ({ params }) => {
    if (!["linkblog", "devblog", "posts"].includes(params.source))
      return new Response("Not found", { status: 404 });
    return new Response(
      await feed(params.source, content.read().entries, config.origin),
      {
        headers: {
          "Content-Type": "application/rss+xml; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  });
  router.options(
    "/:source/rss.xml",
    () =>
      new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      }),
  );
  router.get(routes.youtube, (context) =>
    context.render(tool("youtube", config)),
  );
  router.get(routes.lastfm, (context) =>
    context.render(tool("lastfm", config)),
  );
  router.get(routes.tweet, (context) => context.render(tool("tweet", config)));
  router.post(
    routes.archive,
    () =>
      new Response(
        "This isn't finished yet, so for now this just returns this :)",
      ),
  );
  router.post(routes.thumbnail, async (context) => {
    const input = (await context.request.formData()).get("url");
    if (typeof input !== "string")
      return new Response("Missing URL parameter", { status: 400 });
    const id = input.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})(?:[?&#/]|$)/,
    )?.[1];
    if (!id)
      return new Response("Could not extract video ID from the provided URL", {
        status: 400,
      });
    return context.render(
      <img
        src={`https://img.youtube.com/vi/${id}/maxresdefault.jpg`}
        alt="YouTube video thumbnail"
      />,
    );
  });
  router.get(routes.nowPlaying, async (context) => {
    if (config.lastfmKey) {
      try {
        const url = new URL("https://ws.audioscrobbler.com/2.0/");
        url.search = new URLSearchParams({
          method: "user.getRecentTracks",
          user: "jackharrhy",
          api_key: config.lastfmKey,
          format: "json",
          limit: "1",
        }).toString();
        const response = await fetch(url, {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok)
          throw new Error(`Last.fm returned ${response.status}`);
        const data = await response.json();
        const track = data.recenttracks?.track?.[0];
        if (track?.["@attr"]?.nowplaying)
          return context.render(
            <div class="p-4 border border-shade-200 rounded-md not-prose">
              <div class="flex items-center justify-between gap-4">
                <div class="w-16 h-16 flex-shrink-0">
                  <img
                    src={track.image[2]["#text"]}
                    alt="Album art"
                    class="w-full h-full border border-shade-200 bg-black"
                  />
                </div>
                <p>
                  <span class="text-shade-500">
                    I'm currently listening to{" "}
                  </span>
                  <a href={track.url} class="hover:underline">
                    {track.name}
                    <span class="text-shade-500"> by </span>
                    {track.artist["#text"]}
                    {track.album["#text"] !== track.name && (
                      <>
                        <span class="text-shade-500"> on </span>
                        {track.album["#text"]}
                      </>
                    )}
                    <span class="text-shade-500">.</span>
                  </a>
                </p>
              </div>
            </div>,
          );
      } catch {
        console.error("Last.fm now-playing request failed");
      }
    }
    return new URL(context.request.url).searchParams.has("debug")
      ? new Response(
          "Either ran into an error, or no track is currently playing.",
        )
      : new Response(null, { status: 204 });
  });
  const boot = Date.now();
  let browserRevision = 0;
  router.get(routes.compare, async (context) => {
    if (!config.development) return new Response("Not found", { status: 404 });
    const pathname = comparePath(
      new URL(context.request.url).searchParams.get("path"),
    );
    const notes = await readNotes();
    return context.render(
      compare(
        config,
        content.read().entries,
        pathname,
        notes.notes[pathname]?.note || "",
        process.env.GARDEN_COMPARE_URL || config.origin,
      ),
    );
  });
  router.get(routes.notes, async () =>
    config.development
      ? Response.json(await readNotes())
      : new Response("Not found", { status: 404 }),
  );
  router.post(routes.saveNote, async ({ request }) => {
    if (!config.development) return new Response("Not found", { status: 404 });
    if (request.headers.get("Origin") !== new URL(request.url).origin)
      return new Response("Forbidden", { status: 403 });
    const data = await request.formData();
    const pathname = comparePath(String(data.get("path") || "/"));
    const note = String(data.get("note") || "");
    if (note.length > 8000)
      return new Response("Note too long", { status: 400 });
    await writeNote(pathname, note);
    return Response.json({ ok: true });
  });
  router.get(routes.raindrop, async (context) => {
    if (!config.development) return new Response("Not found", { status: 404 });
    try {
      const status = await getLinkblogRaindropStatus({
        vaultPath: config.directory,
        refresh: new URL(context.request.url).searchParams.has("refresh"),
      });
      if (context.request.headers.get("Accept")?.includes("application/json"))
        return Response.json(status);
      return context.render(raindropStatus(config, status));
    } catch (error) {
      return context.render(
        raindropStatus(
          config,
          undefined,
          error instanceof Error ? error.message : "Raindrop request failed",
        ),
      );
    }
  });
  router.get(routes.changes, () =>
    config.development
      ? new Response(`${boot}:${content.revision}:${browserRevision}`, {
          headers: { "Cache-Control": "no-store" },
        })
      : new Response("Not found", { status: 404 }),
  );
  router.get(routes.debug, (context) =>
    !config.development
      ? new Response("Not found", { status: 404 })
      : context.render(
          document({
            ...config,
            title: "Debug",
            children: (
              <>
                <h1>Garden</h1>
                <p>{content.read().entries.length} public pages</p>
                <p>
                  <a href="/debug/compare">Compare local vs production</a> ·{" "}
                  <a href="/debug/linkblog">Linkblog Raindrop todo</a>
                </p>
                <ul>
                  {content.read().entries.map((entry) => (
                    <li>
                      <a href={`/${entry.id}`}>{entry.sourcePath}</a>
                    </li>
                  ))}
                </ul>
              </>
            ),
          }),
        ),
  );
  router.get(routes.manifest, async () => {
    if (config.development)
      return Response.json({
        pages: content.read().entries.map((entry) => ({
          route: `/${entry.id}`,
          sourcePath: entry.sourcePath,
        })),
      });
    return new Response(
      await fs.readFile(path.join(config.directory, "deploy-manifest.json")),
      { headers: { "Content-Type": "application/json" } },
    );
  });
  router.get(routes.page, (context) => {
    if (context.params.slug.endsWith("/")) {
      const url = new URL(context.request.url);
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      return router.fetch(new Request(url, context.request));
    }
    if (
      context.params.slug.startsWith("debug/") ||
      context.params.slug.startsWith("__dev/")
    )
      return new Response("Not found", { status: 404 });
    return renderPage(context.params.slug, context);
  });
  return {
    router,
    content,
    reloadBrowser() {
      browserRevision++;
    },
  };
}
