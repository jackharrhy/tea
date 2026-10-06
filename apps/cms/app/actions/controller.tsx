import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { routes } from "../routes.ts";
import { assets } from "../assets.ts";
import { contentContext, userContext } from "../middleware/context.ts";
import type { SiteRuntime } from "../site.ts";
import type { OperatorAccess } from "../operator-access.ts";
import { operatorSiteCookieName, sessionCookie } from "../data/auth.ts";
import { serveMedia } from "./media.ts";
import { sitemapXml } from "./public-seo.ts";

export function createPublicController(
  site: SiteRuntime,
  operator?: OperatorAccess,
) {
  const PublicPage = site.definition.Page;
  return createController(routes, {
    actions: {
      operatorEnter(c) {
        const ticket = c.url.searchParams.get("ticket") ?? "";
        const session = operator?.redeemTicket(site.id, ticket);
        if (!session)
          return new Response("Invalid or expired entry link", { status: 403 });
        return new Response(null, {
          status: 303,
          headers: {
            Location: routes.admin.index.href(),
            "Set-Cookie": sessionCookie(
              c.request,
              session.id,
              session.expiresAt,
              site.origin,
              operatorSiteCookieName(site.id),
              "Lax",
            ),
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      },
      sitemap(c) {
        const store = c.get(contentContext);
        return new Response(
          sitemapXml([store.homepage(), ...store.pages()], store.site()),
          {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        );
      },
      robots(c) {
        const settings = c.get(contentContext).site();
        const sitemap = new URL(
          routes.sitemap.href(),
          settings.canonical_origin,
        ).href;
        return new Response(
          site.preview
            ? "User-agent: *\nDisallow: /\n"
            : `User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`,
          {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        );
      },
      async assets(c) {
        return (
          (await assets.fetch(c.request)) ??
          new Response("Not found", { status: 404 })
        );
      },
      home(c) {
        const store = c.get(contentContext);
        const editorSession = !!c.get(userContext);
        const visualEditing =
          editorSession && c.url.searchParams.get("tea_edit") === "1";
        const response = c.render(
          <PublicPage
            features={site.definition.features}
            page={visualEditing ? store.editorPage("") : store.homepage()}
            store={store}
            path="/"
            previewSite={site.preview}
            preview={c.url.searchParams.has("preview")}
            visualEditing={visualEditing}
            editorSession={editorSession}
          />,
        );
        if (editorSession)
          response.headers.set("Cache-Control", "private, no-store");
        return response;
      },
      page(c) {
        const store = c.get(contentContext),
          slug = c.params.slug.replace(/\/+$/, ""),
          editorSession = !!c.get(userContext),
          visualEditing =
            editorSession && c.url.searchParams.get("tea_edit") === "1",
          page = visualEditing ? store.editorPage(slug) : store.page(slug);
        if (page && slug !== c.params.slug)
          return redirect(routes.page.href({ slug }) + c.url.search, 301);
        const response = c.render(
          <PublicPage
            features={site.definition.features}
            page={page}
            store={store}
            path={c.url.pathname}
            previewSite={site.preview}
            preview={c.url.searchParams.has("preview")}
            visualEditing={visualEditing}
            editorSession={editorSession}
          />,
          { status: page ? 200 : 404 },
        );
        if (editorSession)
          response.headers.set("Cache-Control", "private, no-store");
        return response;
      },
      file(c) {
        return serveMedia(c.request, c.params.id, c.get(contentContext));
      },
      health(c) {
        c.get(contentContext).sqlite.prepare("SELECT 1").get();
        return Response.json({ ok: true, app: "TeaCMS", framework: "Remix 3" });
      },
    },
  });
}
