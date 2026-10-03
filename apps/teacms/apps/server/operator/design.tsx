import type { Handle } from "remix/component";
import { AdminBrand } from "@teacms/core/ui/admin-brand.tsx";
import { Document } from "@teacms/core/ui/document.tsx";

const colors = [
  ["--canvas", "Page background"],
  ["--paper", "Fields and panels"],
  ["--surface", "Quiet controls"],
  ["--surface-hover", "Control hover"],
  ["--ink", "Main text"],
  ["--muted", "Secondary text"],
  ["--line", "Borders"],
  ["--field-border", "Field hover"],
  ["--tea", "Warm detail"],
  ["--accent", "Primary action"],
  ["--accent-hover", "Primary hover"],
  ["--accent-soft", "Positive background"],
  ["--on-accent", "Text on green"],
  ["--danger", "Errors and destructive actions"],
  ["--danger-hover", "Destructive hover"],
  ["--danger-soft", "Error background"],
  ["--danger-soft-hover", "Destructive control hover"],
  ["--shadow", "Dialog shadow"],
  ["--backdrop", "Dialog backdrop"],
] as const;

const links = [
  ["#colors", "Colors"],
  ["#type", "Type"],
  ["#shape", "Shape"],
  ["#buttons", "Buttons"],
  ["#fields", "Fields"],
  ["#feedback", "Feedback"],
  ["#patterns", "Patterns"],
] as const;

function ColorToken(handle: Handle<{ name: string; use: string }>) {
  return () => (
    <div className="design-color">
      <span
        className="design-color-swatch"
        style={{ backgroundColor: `var(${handle.props.name})` }}
      />
      <span className="design-color-meta">
        <strong>{handle.props.name}</strong>
        <small>{handle.props.use}</small>
        <code data-token-value={handle.props.name}></code>
      </span>
    </div>
  );
}

export function Design(_handle: Handle) {
  return () => (
    <Document
      title="Design · teacms"
      admin
      static
      head={
        <>
          <link rel="stylesheet" href="/operator.css" />
          <link rel="stylesheet" href="/design.css" />
          <script src="/design.js" defer></script>
        </>
      }
    >
      <a className="skip-link" href="#design-content">
        Skip to content
      </a>
      <header className="design-header">
        <AdminBrand href="/" />
        <nav aria-label="Page links">
          <a href="#colors">Colors</a>
          <a href="#patterns">Patterns</a>
          <a href="/login">Sign in</a>
        </nav>
      </header>
      <div className="design-layout">
        <aside className="design-index" aria-label="On this page">
          <span>On this page</span>
          <nav>
            {links.map(([href, label]) => (
              <a href={href}>{label}</a>
            ))}
          </nav>
        </aside>
        <main id="design-content" className="design-main">
          <div className="design-intro">
            <p className="design-kicker">teacms / design</p>
            <h1>Design</h1>
            <p>Colors, type, controls, and patterns used in the editor.</p>
          </div>

          <section className="design-section" id="colors">
            <div className="design-section-head">
              <span>01</span>
              <div>
                <h2>Colors</h2>
                <p>
                  These are the live CSS values. The page reads them from the
                  admin stylesheet.
                </p>
              </div>
            </div>
            <div className="design-colors">
              {colors.map(([name, use]) => (
                <ColorToken name={name} use={use} />
              ))}
            </div>
          </section>

          <section className="design-section" id="type">
            <div className="design-section-head">
              <span>02</span>
              <div>
                <h2>Type</h2>
                <p>Inter Variable, served by teacms. Weights 100–900.</p>
              </div>
            </div>
            <div className="design-type-list">
              <div className="design-type-row">
                <small>Heading 1 · 26–34px</small>
                <h1>Make a page, then make it yours.</h1>
              </div>
              <div className="design-type-row">
                <small>Heading 2 · 20px</small>
                <h2>Pages and media</h2>
              </div>
              <div className="design-type-row">
                <small>Heading 3 · 14px</small>
                <h3>Search &amp; sharing</h3>
              </div>
              <div className="design-type-row">
                <small>Body · 14px / 1.5</small>
                <p>
                  Drafts stay private until you publish them. You can keep
                  editing without changing the live page.
                </p>
              </div>
              <div className="design-type-row">
                <small>Small · 12px</small>
                <small>Updated a moment ago</small>
              </div>
            </div>
          </section>

          <section className="design-section" id="shape">
            <div className="design-section-head">
              <span>03</span>
              <div>
                <h2>Shape &amp; spacing</h2>
                <p>
                  Light borders and small corners keep dense screens easy to
                  scan.
                </p>
              </div>
            </div>
            <div className="design-shapes">
              <div className="design-shape-card">
                <div className="design-radius-panel"></div>
                <strong>Panel radius</strong>
                <code data-token-value="--radius"></code>
              </div>
              <div className="design-shape-card">
                <div className="design-radius-control"></div>
                <strong>Control radius</strong>
                <code data-token-value="--radius-control"></code>
              </div>
              <div className="design-shape-card">
                <div className="design-focus-example" tabIndex={0}>
                  Tab to focus
                </div>
                <strong>Focus outline</strong>
                <code>3px solid --accent</code>
              </div>
            </div>
            <p className="design-note">
              Spacing is currently set per component; there is no shared spacing
              scale.
            </p>
          </section>

          <section className="design-section" id="buttons">
            <div className="design-section-head">
              <span>04</span>
              <div>
                <h2>Buttons</h2>
                <p>
                  Primary actions are green. Destructive actions use red text.
                </p>
              </div>
            </div>
            <div className="design-sample">
              <div className="design-button-row">
                <button type="button" className="button primary">
                  Publish page
                </button>
                <button type="button" className="button">
                  Save draft
                </button>
                <button type="button" className="button danger">
                  Delete
                </button>
                <button type="button" className="button small">
                  Small button
                </button>
                <button type="button" className="text-button">
                  Text button
                </button>
                <button type="button" className="text-button danger">
                  Destructive text
                </button>
                <button type="button" className="button primary" disabled>
                  Unavailable
                </button>
              </div>
              <p className="design-caption">
                Default controls are 40px high; small controls are 32px. Hover
                to compare the states.
              </p>
            </div>
          </section>

          <section className="design-section" id="fields">
            <div className="design-section-head">
              <span>05</span>
              <div>
                <h2>Fields</h2>
                <p>
                  Labels stay visible; help text sits below the field it
                  explains.
                </p>
              </div>
            </div>
            <div className="design-sample design-form-sample">
              <div className="field-grid">
                <label>
                  Page title
                  <input type="text" placeholder="A new page" />
                  <small>Shown in the editor and on the website.</small>
                </label>
                <label>
                  Visibility
                  <select defaultValue="published">
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </label>
              </div>
              <label>
                Description
                <textarea
                  rows={3}
                  placeholder="A short description for search and sharing."
                />
              </label>
              <label className="check-label">
                <input type="checkbox" defaultChecked />
                Show in navigation
              </label>
            </div>
          </section>

          <section className="design-section" id="feedback">
            <div className="design-section-head">
              <span>06</span>
              <div>
                <h2>Feedback</h2>
                <p>State labels use words as well as color.</p>
              </div>
            </div>
            <div className="design-sample">
              <div className="design-badges">
                <span className="badge good">Published</span>
                <span className="badge">Draft</span>
                <span className="badge error">Unavailable</span>
                <span className="count">12</span>
              </div>
              <div className="notice">
                Draft saved. The live page has not changed.
              </div>
              <div className="notice error">
                This file is too large to upload.
              </div>
              <div className="design-empty empty-state">
                <strong>No pages yet</strong>
                <p>Create a page to start adding content.</p>
                <button type="button" className="button primary">
                  New page
                </button>
              </div>
            </div>
          </section>

          <section className="design-section" id="patterns">
            <div className="design-section-head">
              <span>07</span>
              <div>
                <h2>Patterns</h2>
                <p>Fixture content in the same layouts used by the app.</p>
              </div>
            </div>
            <div className="design-pattern">
              <div className="design-pattern-label">Page list row</div>
              <div className="page-list">
                <div className="list-heading">
                  <span>PAGE</span>
                  <span>CONTENT</span>
                  <span>SEARCH</span>
                </div>
                <div className="page-row">
                  <div className="page-identity">
                    <span className="page-monogram">N</span>
                    <span>
                      <strong>Notes</strong>
                      <small>/notes · Unpublished changes</small>
                    </span>
                  </div>
                  <span className="muted">4 blocks</span>
                  <span className="badge">Needs description</span>
                  <span className="row-arrow">↗</span>
                </div>
              </div>
            </div>
            <div className="design-pattern">
              <div className="design-pattern-label">Review item</div>
              <div className="task-row">
                <strong>Page descriptions</strong>
                <p>2 pages need a description.</p>
              </div>
            </div>
            <div className="design-pattern">
              <div className="design-pattern-label">Search preview</div>
              <div className="seo-preview">
                <div>
                  <span className="search-url">example.com/notes</span>
                  <h3>Notes · Example site</h3>
                  <p>Short updates from the studio.</p>
                  <ul
                    className="seo-checks"
                    aria-label="Search and sharing details"
                  >
                    <li>Page description set</li>
                    <li>Add a sharing image</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="design-pattern">
              <div className="design-pattern-label">Media tile</div>
              <div className="design-media-fixture">
                <div className="media-tile">
                  <div className="file-preview">PNG</div>
                  <span>
                    <strong>cover-image.png</strong>
                    <small>Image · 240 KB</small>
                  </span>
                </div>
              </div>
            </div>
            <div className="design-pattern">
              <div className="design-pattern-label">Editor actions</div>
              <div className="design-editor-fixture">
                <div className="editor-heading">
                  <div>
                    <span className="back-link">← Pages</span>
                    <h1>Notes</h1>
                    <span className="muted">/notes ↗</span>
                  </div>
                  <div className="editor-actions">
                    <span className="save-status pending">Unsaved changes</span>
                    <button type="button" className="button">
                      Save draft
                    </button>
                    <button type="button" className="button primary">
                      Publish
                    </button>
                  </div>
                </div>
                <div className="editor-toolbar">
                  <div>
                    <button type="button" className="button small">
                      ↶ Undo
                    </button>
                    <button type="button" className="button small" disabled>
                      ↷ Redo
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="design-pattern">
              <div className="design-pattern-label">Site summary</div>
              <div className="operator-sites">
                <article className="operator-site">
                  <div className="operator-site-info">
                    <div className="operator-site-head">
                      <h2>Example site</h2>
                      <span className="badge good">Healthy</span>
                    </div>
                    <p className="operator-description">
                      A fixture site for this design page.
                    </p>
                    <span className="operator-origin">example.com ↗</span>
                  </div>
                  <dl className="operator-facts">
                    <div>
                      <dt>Pages</dt>
                      <dd>8</dd>
                    </div>
                    <div>
                      <dt>Drafts</dt>
                      <dd>2</dd>
                    </div>
                    <div>
                      <dt>Media</dt>
                      <dd>14</dd>
                    </div>
                    <div>
                      <dt>Mode</dt>
                      <dd>Preview</dd>
                    </div>
                    <div>
                      <dt>Analytics</dt>
                      <dd>Off</dd>
                    </div>
                  </dl>
                  <div>
                    <button type="button" className="button primary">
                      Open editor
                    </button>
                  </div>
                </article>
              </div>
            </div>
          </section>
          <footer className="design-footer">
            <AdminBrand href="/" />
            <a href="#design-content">Back to top ↑</a>
          </footer>
        </main>
      </div>
    </Document>
  );
}
