import * as s from "remix/data-schema";
import { sidebarSchema, siteSchema, adornmentSchema } from "./input.ts";
import {
  saveAdornment,
  deleteAdornment,
} from "../../features/adornments/adornments.ts";
import {
  mediaFolders,
  saveFolder,
  deleteFolder,
  saveMediaDetails,
} from "../../data/media-folders.ts";
import { createController } from "remix/router";
import { routes } from "../../routes.ts";
import { contentContext, requireEditor } from "../../middleware/context.ts";
import { readInput, parsePage, invalid } from "../input.ts";
import { uploadMedia, deleteMedia } from "../media.ts";
import type { SiteRuntime } from "../../site.ts";
import { Overview } from "./overview.tsx";
import { createPageActions } from "./page-actions.tsx";
import { AdminLayout } from "./layout.tsx";
import { MediaLibrary } from "./public/media-library.tsx";
import { NavigationEditor as DefaultNavigationEditor } from "./public/navigation-editor.tsx";
import { AdornmentLibrary } from "../../features/adornments/public/adornment-library.tsx";
import { SiteSettings } from "./public/site-settings.tsx";
import {
  SearchAppearance,
  searchAppearanceRows,
} from "./search-appearance.tsx";

export function createAdminController(
  site: SiteRuntime,
  operatorOrigin?: string,
) {
  const PublicPage = site.definition.Page;
  const NavigationEditor =
    site.definition.NavigationEditor ?? DefaultNavigationEditor;
  return createController(routes.admin, {
    middleware: [requireEditor],
    actions: {
      index(c) {
        return c.render(
          <Overview
            site={site}
            store={c.get(contentContext)}
            operatorOrigin={operatorOrigin}
          />,
        );
      },
      ...createPageActions(site, operatorOrigin),
      media(c) {
        const store = c.get(contentContext),
          media = store.media();
        return c.render(
          <AdminLayout
            siteName={site.name}
            operatorOrigin={operatorOrigin}
            adornments={site.definition.features.adornments}
            title="Media library"
            path="/tea/admin/media"
            wide
          >
            <MediaLibrary
              media={media}
              folders={mediaFolders(store)}
              adornmentMedia={store
                .adornments()
                .map((a) => a.media_id)
                .filter((id): id is string => !!id)}
              references={store.mediaUsage()}
            />
          </AdminLayout>,
        );
      },
      upload(c) {
        return uploadMedia(c.request, c.get(contentContext));
      },
      async updateMedia(c) {
        const data = await readInput(c.request),
          store = c.get(contentContext);
        const result = saveMediaDetails(store, c.params.id, data);
        return result.ok ? Response.json(result) : invalid(result.error);
      },
      async saveFolder(c) {
        const result = saveFolder(
          c.get(contentContext),
          await readInput(c.request),
        );
        return result.ok ? Response.json(result) : invalid(result.error);
      },
      deleteFolder(c) {
        const result = deleteFolder(c.get(contentContext), c.params.id);
        return result.ok ? Response.json(result) : invalid(result.error, 409);
      },
      deleteMedia(c) {
        return deleteMedia(c.params.id, c.get(contentContext));
      },
      sidebar(c) {
        const store = c.get(contentContext);
        return c.render(
          <AdminLayout
            siteName={site.name}
            operatorOrigin={operatorOrigin}
            adornments={site.definition.features.adornments}
            title="Navigation"
            path="/tea/admin/sidebar"
          >
            <NavigationEditor
              sidebar={store.sidebar()}
              media={store.media()}
              pages={store.pages()}
            />
          </AdminLayout>,
        );
      },
      async saveSidebar(c) {
        const parsed = s.parseSafe(sidebarSchema, await readInput(c.request));
        if (!parsed.success)
          return invalid("Check navigation labels, links, and images.");
        const data = parsed.value,
          store = c.get(contentContext);
        if (
          (data.top_image_id && !store.mediaItem(data.top_image_id)) ||
          data.categories.some(
            (category) =>
              (category.backgroundImageId &&
                !store.mediaItem(category.backgroundImageId)) ||
              category.items.some((item) => !store.page(item.pageSlug)),
          )
        )
          return invalid("Choose existing pages and images.");
        const result = store.saveSidebar(data, data.revision);
        return result.ok
          ? Response.json(result)
          : invalid(result.error, result.status);
      },
      adornments(c) {
        if (!site.definition.features.adornments)
          return new Response("Not found", { status: 404 });
        const store = c.get(contentContext);
        return c.render(
          <AdminLayout
            siteName={site.name}
            operatorOrigin={operatorOrigin}
            adornments={site.definition.features.adornments}
            title="Adornments"
            path="/tea/admin/adornments"
          >
            <AdornmentLibrary
              adornments={store.adornments()}
              media={store.media()}
            />
          </AdminLayout>,
        );
      },
      async saveAdornment(c) {
        if (!site.definition.features.adornments)
          return new Response("Not found", { status: 404 });
        const parsed = s.parseSafe(adornmentSchema, await readInput(c.request));
        if (!parsed.success)
          return invalid(
            "Add a name, choose artwork, and check the layout values.",
          );
        const result = saveAdornment(c.get(contentContext), parsed.value);
        return result.ok
          ? Response.json(result)
          : invalid(result.error, result.status);
      },
      deleteAdornment(c) {
        if (!site.definition.features.adornments)
          return new Response("Not found", { status: 404 });
        const result = deleteAdornment(c.get(contentContext), c.params.id);
        return result.ok
          ? Response.json(result)
          : invalid(result.error, result.status);
      },
      site(c) {
        return c.render(
          <AdminLayout
            siteName={site.name}
            operatorOrigin={operatorOrigin}
            adornments={site.definition.features.adornments}
            title="Site settings"
            path="/tea/admin/site"
          >
            <SiteSettings site={c.get(contentContext).site()} />
          </AdminLayout>,
        );
      },
      async saveSite(c) {
        const parsed = s.parseSafe(siteSchema, await readInput(c.request));
        if (!parsed.success)
          return invalid(
            "Check the site name, background color, and website origin.",
          );
        const result = c
          .get(contentContext)
          .saveSite(parsed.value, parsed.value.revision);
        return result.ok
          ? Response.json(result)
          : invalid(result.error, result.status);
      },
      seo(c) {
        const store = c.get(contentContext);
        return c.render(
          <AdminLayout
            siteName={site.name}
            operatorOrigin={operatorOrigin}
            adornments={site.definition.features.adornments}
            title="Search & sharing"
            path="/tea/admin/seo"
          >
            <SearchAppearance
              rows={searchAppearanceRows(store)}
              site={store.site()}
              filter={c.url.searchParams.get("filter") ?? "all"}
            />
          </AdminLayout>,
        );
      },
      async preview(c) {
        const input = await readInput(c.request),
          page = parsePage(input);
        if (!page) return invalid("Preview could not read this page.");
        return c.render(
          <PublicPage
            features={site.definition.features}
            store={c.get(contentContext)}
            page={{
              ...page,
              id: "preview",
              slug: typeof input?.slug === "string" ? input.slug : "",
            }}
            path={"/" + (input?.slug ?? "")}
            preview
          />,
        );
      },
      history(c) {
        const rows = c
          .get(contentContext)
          .sqlite.prepare(
            "SELECT id,snapshot,created_at FROM content_history WHERE content_id=? AND kind IN ('page','homepage') ORDER BY id DESC LIMIT 30",
          )
          .all(c.params.id);
        return Response.json(rows);
      },
    },
  });
}
