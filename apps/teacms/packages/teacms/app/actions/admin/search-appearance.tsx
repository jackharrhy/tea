import type { Handle } from "remix/component";
import type { ContentStore } from "../../data/content.ts";
import type { Page } from "../../ui/public/content-types.ts";
import { routes } from "../../routes.ts";
import { pageMetadata } from "../public-seo.ts";

type Site = ReturnType<ContentStore["site"]>;

function appearance(page: Page, site: Site) {
  const path = page.slug
    ? routes.page.href({ slug: page.slug })
    : routes.home.href();
  const url = new URL(path, site.canonical_origin).href;
  const metadata = pageMetadata(page, site, path);
  return {
    ...metadata,
    imageSrc: page.seo.image_id
      ? routes.file.href({ id: page.seo.image_id })
      : null,
    hidden: page.seo.no_index,
    elsewhere: metadata.canonical !== url,
    defaultDescription: !page.seo.description && !!site.description,
    missing: !metadata.description?.trim() || !metadata.image,
  };
}

export function searchAppearanceRows(store: ContentStore) {
  const site = store.site();
  const published = new Map(
    [store.homepage(), ...store.pages()].map((p) => [p.slug, p]),
  );
  return [store.editorPage("")!, ...store.editorPages()].map((page) => {
    const live = published.get(page.slug);
    return {
      slug: page.slug,
      title: live?.title ?? page.title,
      editHref:
        (page.slug
          ? routes.admin.edit.href({ slug: page.slug })
          : routes.admin.homepage.href()) + "?section=seo#search-sharing",
      live: live ? appearance(live, site) : null,
      draft: page.hasDraft ? appearance(page, site) : null,
    };
  });
}

type Appearance = ReturnType<typeof appearance>;
type Row = ReturnType<typeof searchAppearanceRows>[number];
const filters = [
  { id: "all", label: "All pages", matches: (_: Row) => true },
  {
    id: "missing",
    label: "Missing details",
    matches: (row: Row) => !!(row.live ?? row.draft)?.missing,
  },
  {
    id: "drafts",
    label: "Unpublished changes",
    matches: (row: Row) => !!row.draft,
  },
];

function AppearancePreview(handle: Handle<{ value: Appearance }>) {
  return () => {
    const value = handle.props.value;
    return (
      <div className="seo-preview">
        <div>
          <span className="search-url">{value.canonical}</span>
          <h3>{value.title}</h3>
          <p>
            {value.description ||
              "No search description. Search engines may use text from the page."}
          </p>
          <ul className="seo-checks" aria-label="Search and sharing details">
            <li>
              {value.description?.trim()
                ? value.defaultDescription
                  ? "Using site description"
                  : "Page description set"
                : "Add a description"}
            </li>
            <li>{value.image ? "Sharing image set" : "Add a sharing image"}</li>
          </ul>
          {value.hidden && (
            <p className="seo-note">
              Hidden from search; excluded from the sitemap.
            </p>
          )}
          {value.elsewhere && (
            <p className="seo-note">
              Canonical points to another URL; excluded from the sitemap.
            </p>
          )}
        </div>
        {value.imageSrc && (
          <img
            className="seo-thumbnail"
            src={value.imageSrc}
            alt="Sharing image"
            loading="lazy"
          />
        )}
      </div>
    );
  };
}

export function SearchAppearance(
  handle: Handle<{ rows: Row[]; filter: string; site: Site }>,
) {
  return () => {
    const { rows, site } = handle.props;
    const selected =
      filters.find((filter) => filter.id === handle.props.filter) ?? filters[0];
    const visible = rows.filter(selected.matches);
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Search & sharing</h1>
          </div>
        </div>
        <section className="seo-defaults" aria-label="Site defaults">
          <div>
            <strong>Site description</strong>
            <p>{site.description || "No default description yet."}</p>
            <small>
              Used when a page has no description of its own. Changes to this
              default go live immediately.
            </small>
          </div>
          <a href={routes.admin.site.href()} data-rmx-document>
            Edit site defaults ↗
          </a>
        </section>
        <nav className="seo-filters" aria-label="Filter search checklist">
          {filters.map((filter) => (
            <a
              href={
                routes.admin.seo.href() +
                (filter.id === "all" ? "" : "?filter=" + filter.id)
              }
              data-rmx-document
              aria-current={filter.id === selected.id ? "page" : undefined}
            >
              {filter.label} <span>{rows.filter(filter.matches).length}</span>
            </a>
          ))}
        </nav>
        <p className="muted seo-help">
          Previews use the website’s metadata. Search engines and sharing apps
          may display it differently.
        </p>
        <div className="seo-list">
          {visible.map((row) => (
            <section className="seo-row" aria-label={row.title}>
              <header className="seo-row-heading">
                <h2>{row.title}</h2>
                <span className="badge">
                  {row.live ? "Live" : "Not published"}
                </span>
                {row.live && row.draft && (
                  <span className="badge">Unpublished changes</span>
                )}
                <a href={row.editHref} data-rmx-document>
                  Edit search & sharing ↗
                </a>
              </header>
              <AppearancePreview value={(row.live ?? row.draft)!} />
              {row.live && row.draft && (
                <details className="seo-draft">
                  <summary>Compare saved draft</summary>
                  <p className="seo-help muted">
                    Not live yet. Publish from the page editor to apply these
                    changes.
                  </p>
                  <AppearancePreview value={row.draft} />
                </details>
              )}
            </section>
          ))}
          {!visible.length && (
            <p className="empty-state">No pages in this view.</p>
          )}
        </div>
        <footer className="seo-footer">
          <span>Generated from published pages</span>
          <a href={routes.sitemap.href()} target="_blank" rel="noreferrer">
            Sitemap ↗
          </a>
          <a href={routes.robots.href()} target="_blank" rel="noreferrer">
            Robots.txt ↗
          </a>
        </footer>
      </>
    );
  };
}
