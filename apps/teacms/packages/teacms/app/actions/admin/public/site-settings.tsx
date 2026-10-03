import { clientEntry, on, type Handle } from "remix/component";

export const SiteSettings = clientEntry(
  import.meta.url,
  function SiteSettings(
    handle: Handle<{
      site: {
        analytics_id: string;
        analytics_enabled: boolean;
        site_name: string;
        canonical_origin: string;
        description: string;
        background_color: string;
        revision: string;
      };
    }>,
  ) {
    let site = { ...handle.props.site },
      error = "",
      status = "",
      saving = false,
      dirty = false;
    function change() {
      dirty = true;
      status = "Unsaved changes";
      handle.update();
    }
    handle.queueTask(() =>
      window.addEventListener(
        "beforeunload",
        (e) => {
          if (dirty) {
            e.preventDefault();
            e.returnValue = "";
          }
        },
        { signal: handle.signal },
      ),
    );
    return () => (
      <>
        <div className="page-heading">
          <div>
            <h1>Site settings</h1>
          </div>
          <button
            className="button primary"
            disabled={saving || !dirty}
            mix={on("click", async () => {
              saving = true;
              error = "";
              handle.update();
              const sent = JSON.stringify(site);
              try {
                const r = await fetch("/tea/admin/site", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: sent,
                });
                const result = await r.json();
                if (!r.ok) throw new Error(result.error);
                dirty = JSON.stringify(site) !== sent;
                site.revision = result.revision;
                status = dirty ? "Unsaved changes" : "Site settings saved.";
              } catch (e) {
                error = (e as Error).message;
              } finally {
                saving = false;
                handle.update();
              }
            })}
          >
            Save settings
          </button>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <p role="status">{status}</p>
        <div className="settings-columns">
          <section className="panel">
            <h2>Identity & appearance</h2>
            <label>
              Website name
              <input
                value={site.site_name}
                mix={on("input", (e) => {
                  site.site_name = e.currentTarget.value;
                  change();
                })}
              />
              <small>Appears in browser tabs and search results.</small>
            </label>
            <label>
              Default description
              <textarea
                rows={4}
                value={site.description}
                mix={on("input", (e) => {
                  site.description = e.currentTarget.value;
                  change();
                })}
              />
              <small>Used for pages without their own description.</small>
            </label>
            <label>
              Website background
              <div className="color-field">
                <input
                  aria-label="Pick background color"
                  type="color"
                  value={
                    /^#[0-9a-f]{6}$/i.test(site.background_color)
                      ? site.background_color
                      : "#ffffff"
                  }
                  mix={on("input", (e) => {
                    site.background_color = e.currentTarget.value;
                    change();
                  })}
                />
                <input
                  aria-label="Background color value"
                  value={site.background_color}
                  mix={on("input", (e) => {
                    site.background_color = e.currentTarget.value;
                    change();
                  })}
                />
              </div>
            </label>
            <div
              className="color-preview"
              style={{ backgroundColor: site.background_color }}
            >
              <span>Website background preview</span>
            </div>
            <h2>Analytics</h2>
            <label>
              Google Analytics measurement ID
              <input
                placeholder="G-XXXXXXXXXX"
                value={site.analytics_id}
                mix={on("input", (e) => {
                  site.analytics_id = e.currentTarget.value.trim();
                  change();
                })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={site.analytics_enabled}
                mix={on("change", (e) => {
                  site.analytics_enabled = e.currentTarget.checked;
                  change();
                })}
              />{" "}
              Enable analytics on public production pages
            </label>
            <h2>Website address</h2>
            <label>
              Canonical origin
              <input
                readOnly
                type="url"
                value={site.canonical_origin}
                mix={on("input", (e) => {
                  site.canonical_origin = e.currentTarget.value;
                  change();
                })}
              />
              <small>
                This address is set by the site administrator and used in search
                and sharing links.
              </small>
            </label>
          </section>
          <aside className="help-panel">
            <h2>Public website</h2>
            <p>
              Background changes apply to every public page. Search titles,
              descriptions, and sharing images can be set per page.
            </p>
            <a href="/tea/admin/seo">Review search appearance →</a>
          </aside>
        </div>
      </>
    );
  },
);
