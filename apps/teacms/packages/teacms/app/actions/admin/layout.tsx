import type { Handle, RemixNode } from "remix/component";
import { Document } from "../../ui/document.tsx";
import { AdminBrand } from "../../ui/admin-brand.tsx";
import { NavigationToggle } from "./public/navigation-toggle.tsx";

const navigation = [
  ["/tea/admin", "Overview", "01"],
  ["/tea/admin/pages", "Pages", "02"],
  ["/tea/admin/homepage", "Homepage", "03"],
  ["/tea/admin/media", "Media library", "04"],
  ["/tea/admin/sidebar", "Navigation", "05"],
  ["/tea/admin/adornments", "Adornments", "06"],
  ["/tea/admin/seo", "Search & sharing", "07"],
  ["/tea/admin/site", "Site settings", "08"],
];
export function AdminLayout(
  handle: Handle<{
    siteName?: string;
    adornments?: boolean;
    title: string;
    path: string;
    children: RemixNode;
    wide?: boolean;
    editor?: boolean;
    operatorOrigin?: string;
  }>,
) {
  return () => (
    <Document
      title={handle.props.title + " · teacms"}
      admin
      head={<meta name="robots" content="noindex, nofollow" />}
    >
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <aside className="cms-sidebar" id="cms-navigation">
        {handle.props.editor && (
          <button
            id="close-cms-navigation"
            type="button"
            className="button small navigation-dismiss"
          >
            Close navigation
          </button>
        )}
        <AdminBrand href="/tea/admin" siteName={handle.props.siteName} />
        <nav aria-label="CMS navigation">
          {navigation
            .filter(
              ([href]) =>
                href !== "/tea/admin/adornments" || handle.props.adornments,
            )
            .map(([href, label]) => (
              <a
                data-rmx-document
                href={href}
                aria-current={handle.props.path === href ? "page" : undefined}
              >
                {label}
              </a>
            ))}
        </nav>
        <div className="sidebar-footer">
          {handle.props.operatorOrigin && (
            <a href={handle.props.operatorOrigin} data-rmx-document>
              Sites <span>↗</span>
            </a>
          )}
          <a href="/" target="_blank">
            Open website <span>↗</span>
          </a>
          <form method="post" action="/tea/logout" data-rmx-document>
            <button className="text-button">Sign out</button>
          </form>
        </div>
      </aside>
      <div
        className={
          "cms-main" +
          (handle.props.wide ? " wide" : "") +
          (handle.props.editor ? " cms-editor" : "")
        }
      >
        {!handle.props.editor && (
          <header className="workspace-bar">
            <NavigationToggle />
            <span>{handle.props.title}</span>
            <span
              className="workspace-status"
              id="workspace-readiness"
              role="status"
            >
              Loading editor…
            </span>
          </header>
        )}
        <noscript>Enable JavaScript to edit.</noscript>
        <main id="workspace" className="workspace" inert aria-busy="true">
          {handle.props.children}
        </main>
      </div>
    </Document>
  );
}
