import type { PublicPageProps } from "@teacms/core/site.ts";
import { PublicDocument } from "@teacms/core/ui/public-document.tsx";
import { unsafeHTML, type Handle } from "remix/component";
import type { Page } from "@teacms/core/ui/public/content-types.ts";
import {
  renderBlocks as renderCoreBlocks,
  mediaUrl,
} from "@teacms/core/actions/block-renderer.ts";

export function PublicPage(handle: Handle<PublicPageProps>) {
  return () => {
    const { page, store, preview, visualEditing, features } = handle.props,
      site = store.site(),
      sidebar = store.sidebar();
    const home = page?.slug === "" || page?.slug === "new-page";
    const priorityImageId = home
      ? page?.blocks.find(
          (block) =>
            block.type === "media" && block.props.role !== "background",
        )?.props.mediaId
      : undefined;
    const renderBlocks = (blocks: Page["blocks"]) =>
      renderCoreBlocks(
        blocks,
        features.adornments ? store.adornments() : [],
        preview || visualEditing,
        {
          plainImages: !features.adornments,
          riso: features.riso,
          priorityImageId,
        },
      );
    const background = home
      ? page?.blocks.find(
          (b) => b.type === "media" && b.props.role === "background",
        )
      : undefined;
    const email = sidebar.links.find((l) => l.url.startsWith("mailto:"));
    const blocks = page
      ? home && background
        ? page.blocks.filter((b) => b.id !== background.id)
        : page.blocks
      : [];
    const listenIndex =
      page?.slug === "media"
        ? blocks.findIndex(
            (b) => b.type === "heading" && b.props.section === "listen",
          )
        : -1;
    let body = renderBlocks(blocks);
    if (listenIndex >= 0) {
      const listening = blocks.slice(listenIndex);
      const firstPlayer = listening.findIndex((b) => b.type === "embed");
      body =
        renderBlocks(blocks.slice(0, listenIndex)) +
        '<div class="listen-section"><div class="listen-intro">' +
        renderBlocks(
          firstPlayer < 0 ? listening : listening.slice(0, firstPlayer),
        ) +
        '</div><div class="listen-recordings">' +
        renderBlocks(firstPlayer < 0 ? [] : listening.slice(firstPlayer)) +
        "</div></div>";
    }
    if (page?.slug === "contact") {
      body =
        '<div class="contact-copy">' +
        renderBlocks(blocks.filter((b) => b.type !== "media")) +
        "</div>" +
        renderBlocks(blocks.filter((b) => b.type === "media"));
    }
    return (
      <PublicDocument {...handle.props}>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <div
          className={home ? "home-stage" : "page-stage"}
          style={
            home && background
              ? {
                  backgroundImage: `url(${mediaUrl(background.props.mediaId)})`,
                }
              : undefined
          }
        >
          <header className="site-header">
            <a className="site-title" href="/">
              {site.site_name}
            </a>
            <div className="header-socials">
              <Socials links={sidebar.links} />
            </div>
            <details className="site-menu">
              <summary aria-label="Toggle navigation">
                <span className="menu-bars" aria-hidden="true"></span>
                <span className="menu-label">Menu</span>
              </summary>
              <nav aria-label="Main navigation">
                {sidebar.categories
                  .flatMap((c) => c.items)
                  .map((item) => (
                    <a
                      href={"/" + item.pageSlug}
                      aria-current={
                        page?.slug === item.pageSlug ? "page" : undefined
                      }
                    >
                      {item.text}
                    </a>
                  ))}
              </nav>
            </details>
          </header>
          <main
            id="content"
            className={
              "site-content page-" + (home ? "home" : (page?.slug ?? "missing"))
            }
          >
            {page ? (
              <article className="prose" innerHTML={unsafeHTML(body)} />
            ) : (
              <article className="prose">
                <h1>Page not found</h1>
                <p>
                  <a href="/">Back to the homepage</a>
                </p>
              </article>
            )}
          </main>
        </div>
        <footer className="site-footer">
          <Socials links={sidebar.links} />
          {email && (
            <a className="footer-email" href={email.url}>
              {email.url.replace(/^mailto:/, "")}
            </a>
          )}
        </footer>
      </PublicDocument>
    );
  };
}

function Socials(
  handle: Handle<{ links: { service: string; url: string }[] }>,
) {
  return () => (
    <div className="social-links">
      {handle.props.links
        .filter((l) => !l.url.startsWith("mailto:"))
        .map((link) => {
          const icon = ["instagram", "soundcloud", "youtube"].includes(
            link.service.toLowerCase(),
          )
            ? link.service.toLowerCase()
            : null;
          return (
            <a
              href={link.url}
              aria-label={link.service}
              target="_blank"
              rel="noopener noreferrer"
            >
              {icon ? (
                <img
                  src={"/icons/" + icon + ".svg"}
                  alt=""
                  width="24"
                  height="24"
                />
              ) : (
                link.service
              )}
            </a>
          );
        })}
    </div>
  );
}
