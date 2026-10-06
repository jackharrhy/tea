import type { SiteRuntime } from "../../site.ts";
import type { Handle } from "remix/component";
import type { ContentStore } from "../../data/content.ts";
import { AdminLayout } from "./layout.tsx";
import { mediaUrl } from "../block-renderer.ts";

export function Overview(
  handle: Handle<{
    site: SiteRuntime;
    store: ContentStore;
    operatorOrigin?: string;
  }>,
) {
  return () => {
    const store = handle.props.store,
      pages = store.editorPages(),
      media = store.media(),
      adornments = store.adornments(),
      pagesWithoutDescriptions = pages.filter((p) => !p.seo.description).length,
      mediaWithoutAlt = media.filter((m) => !m.alt).length;
    const portrait = store
      .homepage()
      .blocks.filter((b) => b.type === "media")[1];
    return (
      <AdminLayout
        siteName={handle.props.site.name}
        operatorOrigin={handle.props.operatorOrigin}
        adornments={handle.props.site.definition.features.adornments}
        title="Overview"
        path="/tea/admin"
      >
        <div className="page-heading">
          <div>
            <h1>Overview</h1>
          </div>
          <a className="button" href="/" target="_blank">
            Open website ↗
          </a>
        </div>
        <section className="overview-feature">
          <div>
            <h2>Homepage</h2>
            <a className="button primary" href="/tea/admin/homepage">
              Edit homepage
            </a>
            <div className="inventory">
              <span>
                <strong>{pages.length}</strong> pages
              </span>
              <span>
                <strong>{media.length}</strong> media files
              </span>
              {handle.props.site.definition.features.adornments && (
                <span>
                  <strong>{adornments.length}</strong> adornments
                </span>
              )}
            </div>
          </div>
          {portrait && (
            <img
              src={mediaUrl(portrait.props.mediaId)}
              alt={portrait.props.alt}
            />
          )}
        </section>
        <div className="overview-columns">
          <section>
            <div className="section-heading">
              <h2>Pages</h2>
              <a href="/tea/admin/pages">All pages →</a>
            </div>
            {pages.slice(0, 6).map((p) => (
              <a className="simple-row" href={"/tea/admin/pages/" + p.slug}>
                <span>
                  {p.title}
                  <small>/{p.slug}</small>
                </span>
                <span>↗</span>
              </a>
            ))}
          </section>
          <section>
            <div className="section-heading">
              <h2>Needs attention</h2>
            </div>
            {pagesWithoutDescriptions > 0 && (
              <a className="task-row" href="/tea/admin/seo">
                <strong>Page descriptions</strong>
                <p>
                  {pagesWithoutDescriptions}{" "}
                  {pagesWithoutDescriptions === 1 ? "page needs" : "pages need"}{" "}
                  a description.
                </p>
              </a>
            )}
            {mediaWithoutAlt > 0 && (
              <a className="task-row" href="/tea/admin/media">
                <strong>Alt text</strong>
                <p>
                  {mediaWithoutAlt}{" "}
                  {mediaWithoutAlt === 1 ? "file needs" : "files need"} alt
                  text.
                </p>
              </a>
            )}
            {!pagesWithoutDescriptions && !mediaWithoutAlt && (
              <p className="muted">Nothing needs attention.</p>
            )}
          </section>
        </div>
      </AdminLayout>
    );
  };
}
