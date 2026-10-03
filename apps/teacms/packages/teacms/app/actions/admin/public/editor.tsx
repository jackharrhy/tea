import type { Features } from "../../../ui/public/features.ts";
import { clientEntry, on, type Handle } from "remix/component";
import type {
  Page,
  Media,
  Adornment,
} from "../../../ui/public/content-types.ts";
import { LivePreview, type PreviewLayout } from "./live-preview.tsx";
import { NavigationButton as NavigationToggle } from "./navigation-toggle.tsx";
import { ResizableWorkspace } from "./resizable-workspace.tsx";
import { BlockList } from "./block-list.tsx";
import { MediaPicker } from "./media-picker.tsx";

export const Editor = clientEntry(
  import.meta.url,
  function Editor(
    handle: Handle<{
      page: Page;
      media: Media[];
      adornments: Adornment[];
      features: Features;
      searchOpen?: boolean;
    }>,
  ) {
    let page = structuredClone(handle.props.page),
      status = page.hasDraft ? "Draft saved" : "Published",
      error = "",
      dirty = false,
      saving = false,
      publishing = false,
      autosave = true,
      epoch = 0,
      version = 0,
      showPreview = true;
    let serverRevision = page.revision;
    let previewLayout: PreviewLayout | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined,
      pickingSeo = false,
      recoverable: Page | null = null,
      historyOpen = false,
      history: { created_at: string; snapshot: string }[] = [];
    let previous = JSON.stringify(page),
      undo: string[] = [],
      redo: string[] = [];
    const endpoint = page.slug
        ? "/tea/admin/pages/" + page.slug
        : "/tea/admin/homepage",
      storageKey = "tea-draft:" + page.id;
    function backup() {
      try {
        localStorage.setItem(storageKey, JSON.stringify(page));
      } catch {}
    }
    function schedule() {
      clearTimeout(timer);
      if (autosave) timer = setTimeout(() => void save(), 1200);
    }
    function changed() {
      const next = JSON.stringify(page);
      if (next === previous) return;
      undo.push(previous);
      if (undo.length > 60) undo.shift();
      redo = [];
      previous = next;
      dirty = true;
      version++;
      status = "Unsaved changes";
      error = "";
      backup();
      schedule();
      handle.update();
    }
    function restore(snapshot: string) {
      const { hasDraft, published } = page;
      page = { ...JSON.parse(snapshot), hasDraft, published };
      page.revision = serverRevision;
      previous = JSON.stringify(page);
      epoch++;
      dirty = true;
      version++;
      status = "Unsaved changes";
      error = "";
      backup();
      schedule();
      handle.update();
    }
    async function save() {
      clearTimeout(timer);
      if (saving || !dirty) return;
      saving = true;
      status = "Saving draft…";
      error = "";
      handle.update();
      const sentVersion = version,
        snapshot = structuredClone(page);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(snapshot),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error ?? "Save failed. Your edits are still here.",
          );
        page.revision = result.revision;
        serverRevision = result.revision;
        page.hasDraft = true;
        dirty = version !== sentVersion;
        status = dirty ? "Unsaved changes" : "Draft saved";
        previous = JSON.stringify(page);
        if (!dirty) {
          try {
            localStorage.removeItem(storageKey);
          } catch {}
        }
      } catch (e) {
        error = e instanceof Error ? e.message : "Save failed. Try again.";
        status = "Changes not saved";
        backup();
      } finally {
        saving = false;
        handle.update();
        if (dirty && !error && autosave) schedule();
      }
    }
    async function publish() {
      if (saving || publishing) return;
      publishing = true;
      handle.update();
      try {
        await save();
        if (dirty || error) return;
        const response = await fetch(endpoint + "/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: page.revision }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        page.revision = result.revision;
        serverRevision = result.revision;
        page.hasDraft = false;
        page.published = true;
        previous = JSON.stringify(page);
        status = "Published";
      } catch (e) {
        error = (e as Error).message;
      } finally {
        publishing = false;
        handle.update();
      }
    }
    handle.queueTask(() => {
      const focusBlock = new URL(window.location.href).searchParams.get(
        "block",
      );
      if (focusBlock) {
        const target = [
          ...document.querySelectorAll<HTMLElement>("[data-block-id]"),
        ].find((element) => element.dataset.blockId === focusBlock);
        target?.scrollIntoView({ block: "center" });
        target?.classList.add("visual-target");
      }
      try {
        const draft = JSON.parse(localStorage.getItem(storageKey) ?? "null");
        if (
          draft &&
          draft.id === page.id &&
          JSON.stringify([draft.title, draft.blocks, draft.seo]) !==
            JSON.stringify([page.title, page.blocks, page.seo])
        ) {
          recoverable = draft;
          handle.update();
        }
      } catch {}
      window.addEventListener(
        "beforeunload",
        (e) => {
          if (dirty || saving) {
            e.preventDefault();
            e.returnValue = "";
          }
        },
        { signal: handle.signal },
      );
      window.addEventListener(
        "keydown",
        (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            void save();
          }
        },
        { signal: handle.signal },
      );
    });
    handle.signal.addEventListener("abort", () => {
      clearTimeout(timer);
    });
    return () => (
      <div className="editor-root" inert={publishing} aria-busy={publishing}>
        <ResizableWorkspace
          showPreview={showPreview}
          editor={
            <>
              <div className="editor-chrome">
                <NavigationToggle />
                <div className="editor-heading">
                  <div>
                    <a className="back-link" href="/tea/admin/pages">
                      ← Pages
                    </a>
                    <h1>{page.slug ? page.title : "Homepage"}</h1>
                    <a className="muted" href={"/" + page.slug} target="_blank">
                      /{page.slug} ↗
                    </a>
                    <a
                      className="muted"
                      href={"/" + page.slug + "?tea_edit=1"}
                      target="_blank"
                    >
                      Edit on site ↗
                    </a>
                  </div>
                  <div className="editor-actions">
                    <span
                      className={
                        "save-status" +
                        (error ? " failed" : dirty ? " pending" : "")
                      }
                      role="status"
                    >
                      {status}
                    </span>
                    <button
                      type="button"
                      className="button"
                      disabled={saving || publishing || !dirty}
                      mix={on("click", () => void save())}
                    >
                      {saving ? "Saving…" : "Save draft"}
                    </button>
                    <button
                      type="button"
                      className="button primary"
                      disabled={
                        saving || publishing || (!dirty && !page.hasDraft)
                      }
                      mix={on("click", () => void publish())}
                    >
                      {publishing ? "Publishing…" : "Publish"}
                    </button>
                  </div>
                </div>
                {error && (
                  <div className="notice error" role="alert">
                    {error}{" "}
                    <button
                      type="button"
                      className="text-button"
                      mix={on("click", () => void save())}
                    >
                      Retry save
                    </button>
                  </div>
                )}
                {recoverable && (
                  <div className="notice">
                    Unsaved draft found.{" "}
                    <button
                      className="text-button"
                      mix={on("click", () => {
                        restore(JSON.stringify(recoverable));
                        recoverable = null;
                      })}
                    >
                      Recover draft
                    </button>
                    <button
                      className="text-button"
                      mix={on("click", () => {
                        localStorage.removeItem(storageKey);
                        recoverable = null;
                        handle.update();
                      })}
                    >
                      Discard draft
                    </button>
                  </div>
                )}
                <div className="editor-toolbar">
                  <div>
                    <button
                      type="button"
                      className="button small"
                      disabled={!undo.length}
                      mix={on("click", () => {
                        redo.push(JSON.stringify(page));
                        restore(undo.pop()!);
                      })}
                    >
                      ↶ Undo
                    </button>
                    <button
                      type="button"
                      className="button small"
                      disabled={!redo.length}
                      mix={on("click", () => {
                        undo.push(JSON.stringify(page));
                        restore(redo.pop()!);
                      })}
                    >
                      ↷ Redo
                    </button>
                    <span className="muted">{page.blocks.length} blocks</span>
                  </div>
                  <div>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={autosave}
                        mix={on("change", (e) => {
                          autosave = e.currentTarget.checked;
                          if (autosave && dirty) schedule();
                          else clearTimeout(timer);
                          handle.update();
                        })}
                      />
                      Autosave draft
                    </label>
                    <button
                      className="button small"
                      mix={on("click", () => {
                        showPreview = !showPreview;
                        handle.update();
                      })}
                    >
                      {showPreview ? "Hide preview" : "Show preview"}
                    </button>
                    <button
                      className="button small"
                      mix={on("click", async () => {
                        historyOpen = !historyOpen;
                        if (historyOpen) {
                          const r = await fetch(
                            "/tea/admin/history/" + page.id,
                          );
                          if (r.ok) history = await r.json();
                        }
                        handle.update();
                      })}
                    >
                      History
                    </button>
                  </div>
                </div>
                {historyOpen && (
                  <section className="history-panel panel">
                    <h2>Earlier versions</h2>
                    <p className="muted">
                      Loading a version changes the draft, not the published
                      page.
                    </p>
                    {history.length ? (
                      history.map((h) => (
                        <div className="simple-row">
                          <span>
                            {new Date(h.created_at + "Z").toLocaleString()}
                            <small>
                              {JSON.parse(h.snapshot).blocks?.length ?? 0}{" "}
                              blocks
                            </small>
                          </span>
                          <button
                            className="button small"
                            mix={on("click", () => {
                              undo.push(JSON.stringify(page));
                              restore(h.snapshot);
                              historyOpen = false;
                            })}
                          >
                            Load version
                          </button>
                        </div>
                      ))
                    ) : (
                      <p>No earlier saves yet.</p>
                    )}
                  </section>
                )}
              </div>
              <section
                className="editor-canvas"
                aria-label="Page editor"
                inert={publishing}
              >
                {page.slug && (
                  <label className="page-title-field">
                    Page title
                    <input
                      value={page.title}
                      mix={on("input", (e) => {
                        page.title = e.currentTarget.value;
                        changed();
                      })}
                    />
                  </label>
                )}
                <BlockList
                  features={handle.props.features}
                  blocks={page.blocks}
                  media={handle.props.media}
                  adornments={handle.props.adornments}
                  epoch={epoch}
                  previewLayout={previewLayout}
                  change={changed}
                />
                <details
                  className="seo-panel panel"
                  id="search-sharing"
                  open={handle.props.searchOpen}
                >
                  <summary>Search & sharing</summary>
                  <div className="field-grid">
                    <label>
                      Search title
                      <input
                        value={page.seo.title ?? ""}
                        placeholder={page.title}
                        mix={on("input", (e) => {
                          page.seo.title = e.currentTarget.value || null;
                          changed();
                        })}
                      />
                    </label>
                    <label>
                      Canonical URL
                      <input
                        type="url"
                        value={page.seo.canonical ?? ""}
                        placeholder="Page address (default)"
                        mix={on("input", (e) => {
                          page.seo.canonical = e.currentTarget.value || null;
                          changed();
                        })}
                      />
                    </label>
                  </div>
                  <label>
                    Search description
                    <textarea
                      rows={3}
                      value={page.seo.description ?? ""}
                      placeholder="Summarize this page"
                      mix={on("input", (e) => {
                        page.seo.description = e.currentTarget.value || null;
                        changed();
                      })}
                    />
                    <small>
                      {page.seo.description?.length ?? 0} characters
                    </small>
                  </label>
                  <div className="seo-image">
                    {page.seo.image_id && (
                      <img
                        src={"/tea/api/media/file/" + page.seo.image_id}
                        alt="Sharing image"
                      />
                    )}
                    <button
                      type="button"
                      className="button"
                      mix={on("click", () => {
                        pickingSeo = true;
                        handle.update();
                      })}
                    >
                      Choose sharing image
                    </button>
                    {page.seo.image_id && (
                      <button
                        className="text-button"
                        mix={on("click", () => {
                          page.seo.image_id = null;
                          changed();
                        })}
                      >
                        Clear image
                      </button>
                    )}
                  </div>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={page.seo.no_index}
                      mix={on("change", (e) => {
                        page.seo.no_index = e.currentTarget.checked;
                        changed();
                      })}
                    />
                    Hide this page from search engines
                  </label>
                </details>
                <noscript>
                  <p className="notice">Enable JavaScript to edit.</p>
                </noscript>
              </section>
            </>
          }
          preview={
            <LivePreview
              page={page}
              measure={(layout) => {
                if (
                  layout.width !== previewLayout?.width ||
                  layout.fontSize !== previewLayout?.fontSize
                ) {
                  previewLayout = layout;
                  handle.update();
                }
              }}
            />
          }
        />
        {pickingSeo && (
          <MediaPicker
            media={handle.props.media}
            choose={(m) => {
              page.seo.image_id = m.id;
              pickingSeo = false;
              changed();
            }}
            close={() => {
              pickingSeo = false;
              handle.update();
            }}
          />
        )}
      </div>
    );
  },
);
