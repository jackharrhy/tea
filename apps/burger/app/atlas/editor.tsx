import { clientEntry, css, on, ref, type Handle } from "remix/component";
import type { Me } from "../types";

type TileType = "floor" | "wall" | "counter";
type Entry = {
  id: number;
  type: TileType;
  src_x: number;
  src_y: number;
  label: string;
};
type Atlas = { url: string; width: number; height: number };
type Cell = { src_x: number; src_y: number };
type ApiResult = { ok: boolean; errors?: { message: string }[] };

const TILE_SIZE = 32;
const SCALE = 2;
const colors: Record<TileType, string> = {
  floor: "#8aab39",
  wall: "#cc444b",
  counter: "#dba14a",
};
const layout = css({
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  height: "100dvh",
  padding: "16px",
  "& h1": { margin: "0", fontSize: "20px" },
  "& button, & select, & input": {
    font: "inherit",
    color: "inherit",
    background: "#28382d",
    border: "1px solid #72816e",
    borderRadius: "3px",
    padding: "5px 9px",
    minHeight: "36px",
  },
  "& button": { cursor: "pointer" },
  "& button:disabled": { opacity: "0.5", cursor: "default" },
  "& button:focus-visible, & input:focus-visible, & select:focus-visible, & a:focus-visible":
    {
      outline: "2px solid #e5c47e",
      outlineOffset: "2px",
    },
  "& label": { display: "flex", gap: "8px", alignItems: "center" },
  "& input[type=text]": { minWidth: "0" },
});
const embeddedLayout = css({
  height: "100%",
  minHeight: "0",
  padding: "8px 10px",
  gap: "6px",
  background: "transparent",
  color: "#ddd",
  "& button, & select, & input": { background: "#222", borderColor: "#444" },
});
const toolbar = css({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "10px",
  padding: "10px",
  background: "#18221b",
});
const embeddedToolbar = css({
  background: "transparent",
  padding: "2px 0",
  "& button, & select": { minHeight: "0", padding: "2px 6px" },
});
const embeddedPane = css({ background: "transparent", padding: "0" });
const panes = css({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(250px, 320px)",
  gap: "16px",
  minHeight: "0",
  flex: "1",
  "@media (max-width: 760px)": { gridTemplateColumns: "1fr", overflow: "auto" },
});
const gridPane = css({
  overflow: "auto",
  background: "#18221b",
  padding: "12px",
});
const formPane = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "start",
  gap: "12px",
  overflow: "auto",
  background: "#18221b",
  padding: "12px",
  "& h2": { margin: "0", fontSize: "16px" },
});

async function request<T>(
  path: string,
  signal: AbortSignal,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal,
    credentials: "same-origin",
  });
  const data = (await response.json()) as T & ApiResult;
  if (!response.ok || ("ok" in data && !data.ok))
    throw new Error(
      data.errors?.map((error) => error.message).join("; ") ||
        `HTTP ${response.status}`,
    );
  return data;
}

export const AtlasEditor = clientEntry(
  "file:///app/atlas/editor.tsx#AtlasEditor",
  function AtlasEditor(handle: Handle<{ embedded?: boolean }>) {
    let signal: AbortSignal | null = null;
    let user: Me | null = null;
    let loading = true;
    let error = "";
    let busy = false;
    let atlas: Atlas | null = null;
    let initial: Entry[] = [];
    let entries: Entry[] = [];
    let palette: number[] = [];
    let selected: Cell | null = null;
    let fillType: TileType = "floor";
    let renameTo = "";
    const update = () => void handle.update();
    const dirty = () => JSON.stringify(entries) !== JSON.stringify(initial);
    const chosen = () =>
      entries.find(
        (entry) =>
          entry.src_x === selected?.src_x && entry.src_y === selected?.src_y,
      ) ?? null;

    async function load() {
      if (!signal) return;
      loading = true;
      error = "";
      update();
      try {
        const [catalog, info, saved] = await Promise.all([
          request<Entry[]>("/api/catalog", signal),
          request<Atlas>("/api/atlas", signal),
          request<{ ids: number[] }>("/api/palette", signal),
        ]);
        if (signal.aborted) return;
        initial = catalog;
        entries = catalog;
        atlas = info;
        palette = saved.ids;
      } catch (reason) {
        if (!signal.aborted)
          error = reason instanceof Error ? reason.message : String(reason);
      } finally {
        loading = false;
        if (!signal.aborted) update();
      }
    }

    async function mutate(path: string, body: unknown, method = "POST") {
      if (!signal || busy) return false;
      busy = true;
      error = "";
      update();
      try {
        await request<ApiResult>(path, signal, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return true;
      } catch (reason) {
        if (!signal.aborted)
          error = reason instanceof Error ? reason.message : String(reason);
        return false;
      } finally {
        busy = false;
        if (!signal.aborted) update();
      }
    }

    function changeEntry(entry: Entry | null) {
      if (!selected) return;
      entries = entries.filter(
        (item) =>
          item.src_x !== selected?.src_x || item.src_y !== selected?.src_y,
      );
      if (entry) entries = [...entries, entry];
      update();
    }

    function fillEmpty() {
      if (!atlas) return;
      const taken = new Set(
        entries.map((entry) => `${entry.src_x},${entry.src_y}`),
      );
      const additions: Entry[] = [];
      for (let y = 0; y < atlas.height; y += TILE_SIZE)
        for (let x = 0; x < atlas.width; x += TILE_SIZE)
          if (!taken.has(`${x},${y}`))
            additions.push({
              id: 0,
              type: fillType,
              src_x: x,
              src_y: y,
              label: `tile-${x / TILE_SIZE}x${y / TILE_SIZE}`,
            });
      entries = [...entries, ...additions];
      update();
    }

    async function save() {
      let nextId =
        entries.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
      const finalEntries = entries.map((entry) =>
        entry.id === 0 ? { ...entry, id: nextId++ } : entry,
      );
      if (await mutate("/api/catalog/save", finalEntries)) await load();
    }

    async function rename(entry: Entry) {
      const to = Number(renameTo);
      if (!Number.isInteger(to) || to <= 0) return;
      if (
        dirty() &&
        !window.confirm("Discard unsaved changes before renumbering?")
      )
        return;
      if (await mutate("/api/catalog/rename", { from: entry.id, to })) {
        renameTo = "";
        await load();
      }
    }

    async function togglePalette(entry: Entry | undefined) {
      if (
        !entry ||
        entry.id === 0 ||
        (palette.length >= 9 && !palette.includes(entry.id))
      )
        return;
      const ids = palette.includes(entry.id)
        ? palette.filter((id) => id !== entry.id)
        : [...palette, entry.id];
      if (await mutate("/api/palette", { ids }, "PUT")) palette = ids;
      update();
    }

    return () => (
      <main
        mix={[
          layout,
          handle.props.embedded && embeddedLayout,
          ref((_node, mountedSignal) => {
            signal = mountedSignal;
            void (async () => {
              try {
                user = await request<Me>("/auth/me", mountedSignal);
                if (mountedSignal.aborted) return;
                if (!user.isAdmin) {
                  error = "An administrator account is required.";
                  loading = false;
                  update();
                  return;
                }
                await load();
              } catch {
                if (mountedSignal.aborted) return;
                error =
                  "Sign in with an administrator account to edit the atlas.";
                loading = false;
                update();
              }
            })();
            mountedSignal.addEventListener(
              "abort",
              () => {
                signal = null;
              },
              { once: true },
            );
          }),
        ]}
      >
        {!handle.props.embedded && (
          <header mix={toolbar}>
            <a href="/">← World</a>
            <h1>Burger atlas</h1>
            {user?.isAdmin && <span>{user.displayName ?? user.username}</span>}
          </header>
        )}
        {error && <p role="alert">{error}</p>}
        {loading ? (
          <p>Loading atlas…</p>
        ) : !user?.isAdmin || !atlas ? null : (
          <>
            <div
              mix={[toolbar, handle.props.embedded && embeddedToolbar]}
              role="toolbar"
              aria-label="Atlas controls"
            >
              <label>
                Fill empty cells
                <select
                  mix={on("change", (event) => {
                    fillType = (event.target as HTMLSelectElement)
                      .value as TileType;
                  })}
                >
                  <option value="floor">Floor</option>
                  <option value="wall">Wall</option>
                  <option value="counter">Counter</option>
                </select>
              </label>
              <button
                type="button"
                disabled={busy}
                mix={on("click", fillEmpty)}
              >
                Fill
              </button>
              <button
                type="button"
                disabled={busy || !dirty()}
                mix={on("click", () => {
                  void save();
                })}
              >
                Save {dirty() ? "(unsaved changes)" : ""}
              </button>
              <button
                type="button"
                disabled={busy}
                mix={on("click", () => {
                  if (!dirty() || window.confirm("Discard unsaved changes?"))
                    void load();
                })}
              >
                Reload
              </button>
              <span>
                Right-click a saved tile to add or remove it from your palette.
              </span>
            </div>
            <div mix={panes}>
              <section
                mix={[gridPane, handle.props.embedded && embeddedPane]}
                aria-label="Atlas grid"
              >
                <div
                  style={{
                    position: "relative",
                    width: `${atlas.width * SCALE}px`,
                    height: `${atlas.height * SCALE}px`,
                    backgroundImage: `url(${atlas.url})`,
                    backgroundSize: `${atlas.width * SCALE}px ${atlas.height * SCALE}px`,
                    imageRendering: "pixelated",
                  }}
                >
                  {Array.from(
                    {
                      length:
                        (atlas.width / TILE_SIZE) * (atlas.height / TILE_SIZE),
                    },
                    (_, index) => {
                      const columns = atlas!.width / TILE_SIZE;
                      const x = (index % columns) * TILE_SIZE;
                      const y = Math.floor(index / columns) * TILE_SIZE;
                      const entry = entries.find(
                        (item) => item.src_x === x && item.src_y === y,
                      );
                      const active =
                        selected?.src_x === x && selected?.src_y === y;
                      return (
                        <button
                          type="button"
                          aria-label={`${entry?.label ?? "Empty"} tile ${x / TILE_SIZE}, ${y / TILE_SIZE}${entry && palette.includes(entry.id) ? ", in palette" : ""}`}
                          aria-pressed={active}
                          title={
                            entry
                              ? `#${entry.id} ${entry.type} ${entry.label}`
                              : "Empty cell"
                          }
                          style={{
                            position: "absolute",
                            left: `${x * SCALE}px`,
                            top: `${y * SCALE}px`,
                            width: `${TILE_SIZE * SCALE}px`,
                            height: `${TILE_SIZE * SCALE}px`,
                            padding: "0",
                            background: "transparent",
                            border: active
                              ? "3px solid #fff"
                              : entry
                                ? `2px solid ${colors[entry.type]}`
                                : "1px dashed #555",
                            boxShadow:
                              entry && palette.includes(entry.id)
                                ? "inset 0 0 0 3px #f9d54e"
                                : "none",
                            cursor: "pointer",
                          }}
                          mix={[
                            on("click", () => {
                              selected = { src_x: x, src_y: y };
                              renameTo = "";
                              update();
                            }),
                            on("contextmenu", (event) => {
                              event.preventDefault();
                              void togglePalette(entry);
                            }),
                          ]}
                        />
                      );
                    },
                  )}
                </div>
              </section>
              <section
                mix={[formPane, handle.props.embedded && embeddedPane]}
                aria-label="Selected tile"
              >
                <h2>Tile details</h2>
                {!selected ? (
                  <p>Select a cell to edit.</p>
                ) : !chosen() ? (
                  <>
                    <p>
                      Empty cell at ({selected.src_x}, {selected.src_y})
                    </p>
                    <button
                      type="button"
                      mix={on("click", () =>
                        changeEntry({
                          id: 0,
                          type: "floor",
                          src_x: selected!.src_x,
                          src_y: selected!.src_y,
                          label: "new tile",
                        }),
                      )}
                    >
                      Create entry
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      Cell ({selected.src_x}, {selected.src_y}) · ID{" "}
                      {chosen()!.id || "new"}
                    </p>
                    <label>
                      Type
                      <select
                        value={chosen()!.type}
                        mix={on("change", (event) =>
                          changeEntry({
                            ...chosen()!,
                            type: (event.target as HTMLSelectElement)
                              .value as TileType,
                          }),
                        )}
                      >
                        <option value="floor">Floor</option>
                        <option value="wall">Wall</option>
                        <option value="counter">Counter</option>
                      </select>
                    </label>
                    <label>
                      Label
                      <input
                        type="text"
                        value={chosen()!.label}
                        mix={on("input", (event) =>
                          changeEntry({
                            ...chosen()!,
                            label: (event.target as HTMLInputElement).value,
                          }),
                        )}
                      />
                    </label>
                    <button
                      type="button"
                      mix={on("click", () => changeEntry(null))}
                    >
                      Delete entry
                    </button>
                    {chosen()!.id !== 0 && (
                      <label>
                        Renumber
                        <input
                          type="number"
                          min="1"
                          value={renameTo}
                          mix={on("input", (event) => {
                            renameTo = (event.target as HTMLInputElement).value;
                            update();
                          })}
                        />
                        <button
                          type="button"
                          disabled={busy || !renameTo}
                          mix={on("click", () => {
                            void rename(chosen()!);
                          })}
                        >
                          Apply
                        </button>
                      </label>
                    )}
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    );
  },
);
