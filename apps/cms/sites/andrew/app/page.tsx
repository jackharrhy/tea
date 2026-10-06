import type { PublicPageProps } from "../../../app/site.ts";
import { PublicDocument } from "../../../app/ui/public-document.tsx";
import { unsafeHTML, type Handle } from "remix/component";
import { renderBlocks, mediaUrl } from "../../../app/actions/block-renderer.ts";
import { siteStyles } from "./styles.ts";

export function PublicPage(handle: Handle<PublicPageProps>) {
  return () => {
    const { page, store, preview, visualEditing, features } = handle.props,
      site = store.site(),
      sidebar = store.sidebar();
    return (
      <PublicDocument {...handle.props} styles={siteStyles}>
        <div className="site-layout">
          <nav className="site-sidebar" aria-label="Main navigation">
            <a href="/" aria-label={site.site_name + " homepage"}>
              {sidebar.top_image_id ? (
                <img
                  className="site-portrait"
                  src={mediaUrl(sidebar.top_image_id)}
                  alt={store.mediaItem(sidebar.top_image_id)?.alt ?? ""}
                />
              ) : (
                site.site_name
              )}
            </a>
            <details className="site-menu" open={!preview}>
              <summary>Menu</summary>
              <div>
                {sidebar.categories.map((c) => (
                  <section>
                    <h2
                      style={{
                        backgroundImage: c.backgroundImageId
                          ? `url(${mediaUrl(c.backgroundImageId)})`
                          : undefined,
                      }}
                    >
                      {c.categoryTitle}
                    </h2>
                    <ul>
                      {c.items.map((i) => (
                        <li>
                          <a
                            href={"/" + i.pageSlug}
                            aria-current={
                              page?.slug === i.pageSlug ? "page" : undefined
                            }
                          >
                            {i.text}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                <a className="contact-link" href="/contact">
                  Contact Me
                </a>
                <div className="social-links">
                  {sidebar.links.map((l) => (
                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                      {l.service}
                    </a>
                  ))}
                </div>
              </div>
            </details>
          </nav>
          <main id="content" className="site-content">
            {page ? (
              <article
                className="prose"
                innerHTML={unsafeHTML(
                  renderBlocks(
                    page.blocks,
                    features.adornments ? store.adornments() : [],
                    preview || visualEditing,
                    { riso: features.riso },
                  ),
                )}
              />
            ) : (
              <>
                <h1>This page wandered off.</h1>
                <p>
                  <a href="/">Back to the homepage</a>
                </p>
              </>
            )}
          </main>
        </div>
      </PublicDocument>
    );
  };
}
