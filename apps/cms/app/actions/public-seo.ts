import { html } from "remix/html-template";
import type { ContentStore } from "../data/content.ts";
import type { Page } from "../ui/public/content-types.ts";
import { routes } from "../routes.ts";

type Site = ReturnType<ContentStore["site"]>;

export function pageMetadata(page: Page | null, site: Site, path: string) {
  const name = page?.seo.title || (page?.slug ? page.title : site.site_name);
  return {
    title: page?.slug ? name + " | " + site.site_name : name,
    canonical: new URL(page?.seo.canonical || path, site.canonical_origin).href,
    description: page?.seo.description || site.description,
    image: page?.seo.image_id
      ? new URL(
          routes.file.href({ id: page.seo.image_id }),
          site.canonical_origin,
        ).href
      : null,
  };
}

export function structuredData(
  metadata: ReturnType<typeof pageMetadata>,
  site: Site,
) {
  const homepage = new URL(routes.home.href(), site.canonical_origin).href;
  const websiteId = new URL("#website", homepage).href;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": websiteId,
        url: homepage,
        name: site.site_name,
        ...(site.description && { description: site.description }),
        inLanguage: "en",
      },
      {
        "@type": "WebPage",
        "@id": new URL("#webpage", metadata.canonical).href,
        url: metadata.canonical,
        name: metadata.title,
        ...(metadata.description && { description: metadata.description }),
        ...(metadata.image && { image: metadata.image }),
        isPartOf: { "@id": websiteId },
        inLanguage: "en",
      },
    ],
  };
  // JSON in a script element must not be able to close that element.
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

export function sitemapXml(pages: Page[], site: Site) {
  const urls = new Set<string>();
  for (const page of pages) {
    if (page.seo.no_index) continue;
    const path = page.slug
      ? routes.page.href({ slug: page.slug })
      : routes.home.href();
    const url = new URL(path, site.canonical_origin).href;
    const { canonical } = pageMetadata(page, site, path);
    if (canonical === url) urls.add(url);
  }
  return String(
    html`<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        ${[...urls].toSorted().map((url) => html`<url><loc>${url}</loc></url>`)}
      </urlset>`,
  );
}
