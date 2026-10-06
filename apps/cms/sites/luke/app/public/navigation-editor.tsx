import { clientEntry, on, type Handle } from "remix/component";
import type { Sidebar, Page } from "../../../../app/ui/public/content-types.ts";

export const NavigationEditor = clientEntry(
  import.meta.url,
  function NavigationEditor(
    handle: Handle<{ sidebar: Sidebar; pages: Page[] }>,
  ) {
    const data = structuredClone(handle.props.sidebar);
    data.categories = [
      { categoryTitle: null, items: data.categories.flatMap((c) => c.items) },
    ];
    data.top_image_id = null;
    const items = data.categories[0].items;
    let dirty = false,
      saving = false,
      status = "",
      error = "";
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
    async function save() {
      saving = true;
      error = "";
      handle.update();
      const sent = JSON.stringify(data);
      try {
        const response = await fetch("/tea/admin/sidebar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: sent,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        dirty = JSON.stringify(data) !== sent;
        data.revision = result.revision;
        status = dirty ? "Unsaved changes" : "Navigation saved.";
      } catch (e) {
        error = (e as Error).message;
      } finally {
        saving = false;
        handle.update();
      }
    }
    return () => (
      <>
        <div className="page-heading">
          <div>
            <h1>Navigation</h1>
            <p className="muted">
              Header links, social profiles, and footer email.
            </p>
          </div>
          <button
            className="button primary"
            disabled={saving || !dirty}
            mix={on("click", () => void save())}
          >
            {saving ? "Saving…" : "Save navigation"}
          </button>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <p role="status" className="save-status">
          {status}
        </p>
        <section className="panel">
          <h2>Pages</h2>
          {items.map((item, i) => (
            <div className="navigation-item">
              <label>
                Link label
                <input
                  value={item.text}
                  mix={on("input", (e) => {
                    item.text = e.currentTarget.value;
                    change();
                  })}
                />
              </label>
              <label>
                Page
                <select
                  value={item.pageSlug}
                  mix={on<HTMLSelectElement>("change", (e) => {
                    item.pageSlug = e.currentTarget.value;
                    change();
                  })}
                >
                  <option value="">Homepage</option>
                  {handle.props.pages.map((p) => (
                    <option value={p.slug}>{p.title}</option>
                  ))}
                </select>
              </label>
              <div className="block-actions">
                <button
                  aria-label="Move link up"
                  disabled={!i}
                  mix={on("click", () => {
                    [items[i - 1], items[i]] = [item, items[i - 1]];
                    change();
                  })}
                >
                  ↑
                </button>
                <button
                  aria-label="Move link down"
                  disabled={i === items.length - 1}
                  mix={on("click", () => {
                    [items[i + 1], items[i]] = [item, items[i + 1]];
                    change();
                  })}
                >
                  ↓
                </button>
                <button
                  aria-label="Remove link"
                  mix={on("click", () => {
                    items.splice(i, 1);
                    change();
                  })}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            className="button small"
            mix={on("click", () => {
              items.push({ text: "New link", pageSlug: "" });
              change();
            })}
          >
            Add link
          </button>
        </section>
        <section className="panel">
          <h2>Social profiles and email</h2>
          <p className="muted">
            Use Instagram, SoundCloud, or YouTube for icons. Add a mailto: URL
            for the footer email.
          </p>
          {data.links.map((link, i) => (
            <div className="navigation-item">
              <label>
                Service
                <input
                  value={link.service}
                  mix={on("input", (e) => {
                    link.service = e.currentTarget.value;
                    change();
                  })}
                />
              </label>
              <label>
                URL
                <input
                  value={link.url}
                  mix={on("input", (e) => {
                    link.url = e.currentTarget.value;
                    change();
                  })}
                />
              </label>
              <button
                className="text-button"
                aria-label="Remove external link"
                mix={on("click", () => {
                  data.links.splice(i, 1);
                  change();
                })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="button small"
            mix={on("click", () => {
              data.links.push({ service: "", url: "" });
              change();
            })}
          >
            Add external link
          </button>
        </section>
      </>
    );
  },
);
