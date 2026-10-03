import type { SiteRuntime } from "../../site.ts";
import type { Handle } from "remix/component";
import type { Page } from "../../ui/public/content-types.ts";
import { AdminLayout } from "./layout.tsx";
import { mediaUrl } from "../block-renderer.ts";

export function Pages(
  handle: Handle<{
    site: SiteRuntime;
    pages: Page[];
    query: string;
    operatorOrigin?: string;
  }>,
) {
  return () => (
    <AdminLayout
      siteName={handle.props.site.name}
      operatorOrigin={handle.props.operatorOrigin}
      adornments={handle.props.site.definition.features.adornments}
      title="Pages"
      path="/tea/admin/pages"
    >
      <div className="page-heading">
        <div>
          <h1>
            Pages<span className="count">{handle.props.pages.length}</span>
          </h1>
        </div>
        <a className="button primary" href="#new-page">
          + New page
        </a>
      </div>
      <form className="search-bar" method="get" data-rmx-document>
        <input
          aria-label="Search pages"
          name="q"
          type="search"
          placeholder="Find a page…"
          defaultValue={handle.props.query}
        />
        <button className="button">Search</button>
      </form>
      <div className="page-list">
        <div className="list-heading">
          <span>PAGE</span>
          <span>CONTENT</span>
          <span>SEARCH</span>
        </div>
        {handle.props.pages.map((p) => {
          const image = p.blocks.find((b) => b.type === "media")?.props.mediaId;
          return (
            <a
              className="page-row"
              href={"/tea/admin/pages/" + p.slug}
              data-rmx-document
            >
              <div className="page-identity">
                {image ? (
                  <img src={mediaUrl(image)} alt="" loading="lazy" />
                ) : (
                  <span className="page-monogram">{p.title.slice(0, 1)}</span>
                )}
                <span>
                  <strong>{p.title}</strong>
                  <small>
                    /{p.slug} ·{" "}
                    {p.hasDraft
                      ? p.published
                        ? "Unpublished changes"
                        : "Draft"
                      : "Published"}
                  </small>
                </span>
              </div>
              <span className="muted">{p.blocks.length} blocks</span>
              <span className={"badge " + (p.seo.description ? "good" : "")}>
                {p.seo.no_index
                  ? "Hidden"
                  : p.seo.description
                    ? "Ready"
                    : "Needs description"}
              </span>
              <span className="row-arrow">↗</span>
            </a>
          );
        })}
        {!handle.props.pages.length && (
          <p className="empty-state">
            No pages found. Try another search or create a page.
          </p>
        )}
      </div>
      <details className="new-page panel" id="new-page">
        <summary>Create a new page</summary>
        <form method="post" action="/tea/admin/pages" data-rmx-document>
          <div className="field-grid">
            <label>
              Page title
              <input name="title" required placeholder="A new project" />
            </label>
            <label>
              Website URL
              <input
                name="slug"
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="a-new-project"
              />
              <small>Lowercase words separated by hyphens.</small>
            </label>
          </div>
          <button className="button primary">Create page →</button>
        </form>
      </details>
    </AdminLayout>
  );
}
