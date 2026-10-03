import { clientEntry, on, type Handle } from "remix/component";
import type { Sidebar, Media, Page } from "../../../ui/public/content-types.ts";
import { MediaPicker } from "./media-picker.tsx";

export const NavigationEditor = clientEntry(
  import.meta.url,
  function NavigationEditor(
    handle: Handle<{ sidebar: Sidebar; media: Media[]; pages: Page[] }>,
  ) {
    let data = structuredClone(handle.props.sidebar),
      status = "",
      error = "",
      dirty = false,
      saving = false,
      picking: number | null = null;
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
        const r = await fetch("/tea/admin/sidebar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: sent,
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
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
            <p className="muted">Sidebar links, in display order.</p>
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
        <div className="settings-columns">
          <section>
            <div className="panel">
              <div className="section-heading">
                <h2>Sidebar image</h2>
                <button
                  className="button small"
                  mix={on("click", () => {
                    picking = -1;
                    handle.update();
                  })}
                >
                  Choose image
                </button>
              </div>
              {data.top_image_id && (
                <img
                  className="navigation-portrait"
                  src={"/tea/api/media/file/" + data.top_image_id}
                  alt="Sidebar image"
                />
              )}
            </div>
            {data.categories.map((category, index) => (
              <section className="panel navigation-category">
                <div className="block-top">
                  <span>Category {index + 1}</span>
                  <div className="block-actions">
                    <button
                      disabled={!index}
                      mix={on("click", () => {
                        [data.categories[index - 1], data.categories[index]] = [
                          category,
                          data.categories[index - 1],
                        ];
                        change();
                      })}
                    >
                      ↑
                    </button>
                    <button
                      disabled={index === data.categories.length - 1}
                      mix={on("click", () => {
                        [data.categories[index + 1], data.categories[index]] = [
                          category,
                          data.categories[index + 1],
                        ];
                        change();
                      })}
                    >
                      ↓
                    </button>
                    <button
                      mix={on("click", () => {
                        if (confirm("Remove this navigation category?")) {
                          data.categories.splice(index, 1);
                          change();
                        }
                      })}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <label>
                  Category title
                  <input
                    value={category.categoryTitle ?? ""}
                    mix={on("input", (e) => {
                      category.categoryTitle = e.currentTarget.value;
                      change();
                    })}
                  />
                </label>
                <div className="category-art">
                  {category.backgroundImageId && (
                    <img
                      src={"/tea/api/media/file/" + category.backgroundImageId}
                      alt="Category background"
                    />
                  )}
                  <button
                    className="text-button"
                    mix={on("click", () => {
                      picking = index;
                      handle.update();
                    })}
                  >
                    Choose background image
                  </button>
                  {category.backgroundImageId && (
                    <button
                      className="text-button"
                      mix={on("click", () => {
                        category.backgroundImageId = null;
                        change();
                      })}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {category.items.map((item, i) => (
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
                          [category.items[i - 1], category.items[i]] = [
                            item,
                            category.items[i - 1],
                          ];
                          change();
                        })}
                      >
                        ↑
                      </button>
                      <button
                        aria-label="Move link down"
                        disabled={i === category.items.length - 1}
                        mix={on("click", () => {
                          [category.items[i + 1], category.items[i]] = [
                            item,
                            category.items[i + 1],
                          ];
                          change();
                        })}
                      >
                        ↓
                      </button>
                      <button
                        aria-label="Remove link"
                        mix={on("click", () => {
                          category.items.splice(i, 1);
                          change();
                        })}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  className="button small"
                  mix={on("click", () => {
                    category.items.push({
                      text: "New link",
                      pageSlug: handle.props.pages[0]?.slug ?? "",
                    });
                    change();
                  })}
                >
                  + Add link
                </button>
              </section>
            ))}
            <button
              className="button"
              mix={on("click", () => {
                data.categories.push({
                  categoryTitle: "New category",
                  items: [],
                });
                change();
              })}
            >
              + Add category
            </button>
            <section className="panel">
              <h2>External links</h2>
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
                      type="url"
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
                + Add external link
              </button>
            </section>
          </section>
          <aside className="help-panel">
            <h2>Sidebar</h2>
            <p>
              Categories group pages. Background images appear behind category
              headings.
            </p>
            <a href="/" target="_blank">
              Open website ↗
            </a>
          </aside>
        </div>
        {picking !== null && (
          <MediaPicker
            media={handle.props.media}
            choose={(m) => {
              if (picking === -1) data.top_image_id = m.id;
              else data.categories[picking!].backgroundImageId = m.id;
              picking = null;
              change();
            }}
            close={() => {
              picking = null;
              handle.update();
            }}
          />
        )}
      </>
    );
  },
);
