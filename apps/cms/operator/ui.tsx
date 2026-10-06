import type { Handle } from "remix/component";
import { Document } from "../app/ui/document.tsx";
import { AdminBrand } from "../app/ui/admin-brand.tsx";
import { operatorStyles } from "./operator-styles.ts";

export type Summary = {
  id: string;
  name: string;
  origin: string;
  description: string;
  preview: boolean;
  healthy: boolean;
  pages: number;
  drafts: number;
  media: number;
  analytics: boolean;
};

export function Login(handle: Handle<{ error?: string; csrf: string }>) {
  return () => (
    <Document title="Sign in · teacms" admin static styles={[operatorStyles]}>
      <main className="operator-login">
        <AdminBrand href="/" />
        <section className="operator-login-panel">
          <h1>Sign in</h1>
          {handle.props.error && (
            <p role="alert" className="notice error">
              {handle.props.error}
            </p>
          )}
          <form method="post" action="/login" data-rmx-document>
            <input type="hidden" name="csrf" value={handle.props.csrf} />
            <label>
              Email address{" "}
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                autoFocus
              />
            </label>
            <label>
              Password{" "}
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
            <button type="submit" className="button primary">
              Sign in
            </button>
          </form>
        </section>
        <a className="operator-design-link" href="/design">
          Design
        </a>
      </main>
    </Document>
  );
}

export function Dashboard(
  handle: Handle<{ email: string; sites: Summary[]; csrf: string }>,
) {
  return () => (
    <Document title="Sites · teacms" admin static styles={[operatorStyles]}>
      <main className="operator-shell">
        <header className="operator-header">
          <AdminBrand href="/" />
          <div className="operator-account">
            <a href="/design">Design</a>
            <span>{handle.props.email}</span>
            <form method="post" action="/logout" data-rmx-document>
              <input type="hidden" name="csrf" value={handle.props.csrf} />
              <button type="submit" className="text-button">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <div className="operator-heading">
          <h1>Sites</h1>
        </div>
        <div className="operator-sites">
          {handle.props.sites.map((site) => (
            <article className="operator-site">
              <div className="operator-site-info">
                <div className="operator-site-head">
                  <h2>{site.name}</h2>
                  <span className={site.healthy ? "badge good" : "badge error"}>
                    {site.healthy ? "Healthy" : "Unavailable"}
                  </span>
                </div>
                {site.description && (
                  <p className="operator-description">{site.description}</p>
                )}
                <a
                  className="operator-origin"
                  href={site.origin}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Visit ${site.name} website`}
                >
                  {new URL(site.origin).host} ↗
                </a>
              </div>
              <dl className="operator-facts">
                <div>
                  <dt>Pages</dt>
                  <dd>{site.pages}</dd>
                </div>
                <div>
                  <dt>Drafts</dt>
                  <dd>{site.drafts}</dd>
                </div>
                <div>
                  <dt>Media</dt>
                  <dd>{site.media}</dd>
                </div>
                <div>
                  <dt>Mode</dt>
                  <dd>{site.preview ? "Preview" : "Live"}</dd>
                </div>
                <div>
                  <dt>Analytics</dt>
                  <dd>{site.analytics && !site.preview ? "On" : "Off"}</dd>
                </div>
              </dl>
              <form
                method="post"
                action={`/enter/${site.id}`}
                data-rmx-document
              >
                <input type="hidden" name="csrf" value={handle.props.csrf} />
                <button
                  type="submit"
                  className="button primary"
                  disabled={!site.healthy}
                  aria-label={`Open ${site.name} editor`}
                >
                  Open editor
                </button>
              </form>
            </article>
          ))}
        </div>
      </main>
    </Document>
  );
}
