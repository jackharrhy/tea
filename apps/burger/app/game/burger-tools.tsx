import { clientEntry, css, on, ref, type Handle } from "remix/component";
import { useGameStore, type SpawnZone, type ZoneEntry } from "../store";
import type { Me } from "../types";

type Panel = "palette" | "zones" | "bots" | "spawn";
type Tile = { id: number; label: string; src_x: number; src_y: number };
type UserOption = { id: string; display_name: string | null };

const toolbar = css({
  position: "fixed",
  top: "8px",
  left: "8px",
  zIndex: 20,
  display: "flex",
  flexWrap: "wrap",
  gap: "4px",
  padding: "6px",
  background: "#2c211d",
  border: "2px solid #f9d54e",
  color: "#fff4bc",
  boxShadow: "3px 3px 0 #111",
  maxWidth: "calc(100vw - 16px)",
  "& button": { cursor: "pointer", minHeight: "32px" },
});
const panelStyle = css({
  position: "fixed",
  top: "56px",
  left: "8px",
  zIndex: 20,
  width: "min(420px, calc(100vw - 16px))",
  maxHeight: "calc(100vh - 72px)",
  overflow: "auto",
  padding: "12px",
  background: "#231c1b",
  color: "#fff4bc",
  border: "2px solid #f9d54e",
  boxShadow: "4px 4px 0 #111",
  "& h2": { margin: "0 0 8px", fontSize: "1rem" },
  "& button": { cursor: "pointer" },
  "& input": { maxWidth: "100%" },
});
const tilesStyle = css({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))",
  gap: "6px",
  maxHeight: "50vh",
  overflowY: "auto",
});
const tileStyle = css({
  display: "grid",
  justifyItems: "center",
  gap: "2px",
  minHeight: "68px",
  padding: "4px",
  border: "2px solid #5b4c41",
  background: "#3c312b",
  color: "#fff4bc",
  fontSize: "11px",
  overflow: "hidden",
  "&[aria-pressed='true']": { borderColor: "#f9d54e" },
});
const row = css({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "6px",
  marginBlock: "8px",
});

async function json<T>(
  path: string,
  signal: AbortSignal,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
function sendKey(key: string) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

export const BurgerTools = clientEntry(
  "file:///app/game/burger-tools.tsx#BurgerTools",
  function BurgerTools(handle: Handle) {
    let user: Me | null = null;
    let editorActive = false;
    let palette: number[] = [];
    let zones: ZoneEntry[] = [];
    let myZoneCount = 0;
    let panel: Panel | null = null;
    let tiles: Tile[] = [];
    let atlasUrl = "/assets/atlas.png";
    let users: UserOption[] = [];
    let selectedZone: number | null = null;
    let bots: number | null = null;
    let spawn: SpawnZone | null = null;
    let busy = false;
    let error = "";
    let activeSignal: AbortSignal | null = null;
    let newZoneInput: HTMLInputElement | null = null;

    const update = () => {
      void handle.update();
    };
    const showError = (reason: unknown) => {
      if (activeSignal?.aborted) return;
      error = reason instanceof Error ? reason.message : String(reason);
      update();
    };
    async function loadPanel(next: Panel) {
      const signal = activeSignal;
      if (!signal) return;
      error = "";
      panel = panel === next ? null : next;
      if (panel !== "spawn") useGameStore.getState().setSpawnDraft(null);
      update();
      if (!panel) return;
      try {
        if (next === "palette") {
          const [catalog, atlas] = await Promise.all([
            json<Tile[]>("/api/catalog", signal),
            json<{ url: string }>("/api/atlas", signal),
          ]);
          if (signal.aborted) return;
          tiles = catalog;
          atlasUrl = atlas.url;
        } else if (next === "zones") {
          await loadZones(signal);
        } else if (next === "bots") {
          bots = (await json<{ count: number }>("/api/bots", signal)).count;
        } else {
          spawn = await json<SpawnZone>("/api/settings/spawn", signal);
          if (!signal.aborted) useGameStore.getState().setSpawnDraft(spawn);
        }
        if (!signal.aborted) update();
      } catch (reason) {
        showError(reason);
      }
    }
    async function loadZones(signal: AbortSignal) {
      const [list, cells, people] = await Promise.all([
        json<{ zones: ZoneEntry[] }>("/api/zones", signal),
        json<{ zones: { id: number; cells: [number, number][] }[] }>(
          "/api/zones/all-cells",
          signal,
        ),
        json<{ users: UserOption[] }>("/api/users", signal),
      ]);
      if (signal.aborted) return;
      users = people.users;
      useGameStore.getState().setZones(list.zones);
      useGameStore
        .getState()
        .setZoneCells(
          new Map(cells.zones.map((zone) => [zone.id, zone.cells])),
        );
    }
    async function toggleTile(id: number) {
      const signal = activeSignal;
      if (!signal || busy) return;
      const next = palette.includes(id)
        ? palette.filter((item) => item !== id)
        : [...palette, id];
      if (next.length > 9) {
        showError("A palette holds at most nine tiles.");
        return;
      }
      busy = true;
      error = "";
      update();
      try {
        const saved = await json<{ ok: boolean; ids: number[] }>(
          "/api/palette",
          signal,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ids: next }),
          },
        );
        if (!saved.ok) throw new Error("Palette save was rejected");
        if (!signal.aborted) useGameStore.getState().setPalette(saved.ids);
      } catch (reason) {
        showError(reason);
      } finally {
        busy = false;
        if (!signal.aborted) update();
      }
    }
    async function createZone() {
      const signal = activeSignal;
      const name = newZoneInput?.value.trim();
      if (!signal || !name || busy) return;
      busy = true;
      error = "";
      update();
      try {
        const created = await json<{ id: number }>("/api/zones", signal, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (newZoneInput) newZoneInput.value = "";
        await loadZones(signal);
        if (!signal.aborted)
          useGameStore.getState().setSelectedZone(created.id);
      } catch (reason) {
        showError(reason);
      } finally {
        busy = false;
        if (!signal.aborted) update();
      }
    }
    async function toggleMember(zone: ZoneEntry, personId: string) {
      const signal = activeSignal;
      if (!signal || busy) return;
      const members = new Set(zone.member_user_ids);
      if (members.has(personId)) members.delete(personId);
      else members.add(personId);
      busy = true;
      error = "";
      update();
      try {
        await json(`/api/zones/${zone.id}/members`, signal, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_ids: [...members] }),
        });
        await loadZones(signal);
      } catch (reason) {
        showError(reason);
      } finally {
        busy = false;
        if (!signal.aborted) update();
      }
    }
    async function resetBots() {
      const signal = activeSignal;
      if (!signal || busy) return;
      busy = true;
      error = "";
      update();
      try {
        const result = await json<{ count: number }>(
          "/api/bots/reset",
          signal,
          { method: "POST" },
        );
        bots = result.count;
      } catch (reason) {
        showError(reason);
      } finally {
        busy = false;
        if (!signal.aborted) update();
      }
    }
    async function saveSpawn() {
      const signal = activeSignal;
      if (!signal || !spawn || busy) return;
      busy = true;
      error = "";
      update();
      try {
        await json("/api/settings/spawn", signal, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(spawn),
        });
      } catch (reason) {
        showError(reason);
      } finally {
        busy = false;
        if (!signal.aborted) update();
      }
    }

    return () => {
      const selected = zones.find((zone) => zone.id === selectedZone);
      const canPaint = user?.isAdmin || myZoneCount > 0;
      return (
        <div
          mix={ref((_node, signal) => {
            activeSignal = signal;
            const sync = () => {
              const state = useGameStore.getState();
              user = state.user;
              editorActive = state.editor?.active ?? false;
              palette = state.palette;
              zones = state.zones.list;
              myZoneCount = state.zones.myZoneCells.size;
              selectedZone = state.zones.selectedId;
              if (!signal.aborted) update();
            };
            const unsubscribe = useGameStore.subscribe(sync);
            signal.addEventListener(
              "abort",
              () => {
                unsubscribe();
                activeSignal = null;
                useGameStore.getState().setSpawnDraft(null);
              },
              { once: true },
            );
            sync();
          })}
        >
          {user && (
            <>
              <div mix={toolbar} role="toolbar" aria-label="Burger tools">
                <button
                  type="button"
                  disabled={!canPaint}
                  aria-pressed={editorActive}
                  mix={on("click", () => sendKey("e"))}
                >
                  Paint [E]
                </button>
                <button
                  type="button"
                  aria-pressed={panel === "palette"}
                  mix={on("click", () => {
                    void loadPanel("palette");
                  })}
                >
                  Palette
                </button>
                {user.isAdmin && (
                  <>
                    <a href="/atlas">Atlas</a>
                    <button
                      type="button"
                      aria-pressed={panel === "zones"}
                      mix={on("click", () => {
                        void loadPanel("zones");
                      })}
                    >
                      Zones
                    </button>
                    <button
                      type="button"
                      aria-pressed={panel === "bots"}
                      mix={on("click", () => {
                        void loadPanel("bots");
                      })}
                    >
                      Bots
                    </button>
                    <button
                      type="button"
                      aria-pressed={panel === "spawn"}
                      mix={on("click", () => {
                        void loadPanel("spawn");
                      })}
                    >
                      Spawn
                    </button>
                    <button
                      type="button"
                      disabled={!selectedZone}
                      mix={on("click", () => sendKey("z"))}
                    >
                      Zone brush [Z]
                    </button>
                  </>
                )}
              </div>
              {panel && (
                <section mix={panelStyle} aria-label={`${panel} tools`}>
                  <h2>
                    {panel === "palette"
                      ? "Tile palette"
                      : panel === "zones"
                        ? "Zones"
                        : panel === "bots"
                          ? "Bots"
                          : "Player spawn"}
                  </h2>
                  {error && <p role="alert">{error}</p>}
                  {panel === "palette" && (
                    <>
                      <p>
                        Choose up to nine tiles. Use E to paint, right-click the
                        canvas to erase.
                      </p>
                      <div mix={tilesStyle}>
                        {tiles.map((tile) => (
                          <button
                            type="button"
                            title={tile.label}
                            aria-pressed={palette.includes(tile.id)}
                            disabled={busy}
                            mix={[
                              tileStyle,
                              on("click", () => {
                                void toggleTile(tile.id);
                              }),
                            ]}
                          >
                            <span
                              style={{
                                width: "32px",
                                height: "32px",
                                imageRendering: "pixelated",
                                backgroundImage: `url(${atlasUrl})`,
                                backgroundPosition: `-${tile.src_x}px -${tile.src_y}px`,
                              }}
                            />
                            <span>{tile.label}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {panel === "zones" && user.isAdmin && (
                    <>
                      <form
                        mix={on("submit", (event) => {
                          event.preventDefault();
                          void createZone();
                        })}
                      >
                        <input
                          aria-label="New zone name"
                          placeholder="New zone name"
                          mix={ref((node) => {
                            newZoneInput = node;
                          })}
                        />
                        <button type="submit" disabled={busy}>
                          Create zone
                        </button>
                      </form>
                      <div mix={row}>
                        {zones.map((zone) => (
                          <button
                            type="button"
                            aria-pressed={zone.id === selectedZone}
                            mix={on("click", () => {
                              useGameStore.getState().setSelectedZone(zone.id);
                            })}
                          >
                            {zone.name} ({zone.cell_count})
                          </button>
                        ))}
                      </div>
                      {selected && (
                        <>
                          <p>
                            Use the zone brush [Z] on the canvas, then assign
                            members.
                          </p>
                          {users.map((person) => (
                            <label mix={row}>
                              <input
                                type="checkbox"
                                checked={selected.member_user_ids.includes(
                                  person.id,
                                )}
                                disabled={busy}
                                mix={on("change", () => {
                                  void toggleMember(selected, person.id);
                                })}
                              />
                              {person.display_name ?? person.id}
                            </label>
                          ))}
                        </>
                      )}
                    </>
                  )}
                  {panel === "bots" && user.isAdmin && (
                    <>
                      <p>Active bots: {bots ?? "…"}</p>
                      <button
                        type="button"
                        disabled={busy}
                        mix={on("click", () => {
                          void resetBots();
                        })}
                      >
                        Reset to spawn
                      </button>
                    </>
                  )}
                  {panel === "spawn" && user.isAdmin && spawn && (
                    <>
                      {(["x", "y", "w", "h"] as const).map((key) => (
                        <label mix={row}>
                          {key.toUpperCase()}{" "}
                          <input
                            type="number"
                            value={spawn![key]}
                            mix={on("change", (event) => {
                              const value = Number(
                                (event.target as HTMLInputElement).value,
                              );
                              if (!Number.isFinite(value) || !spawn) return;
                              spawn = { ...spawn, [key]: Math.round(value) };
                              useGameStore.getState().setSpawnDraft(spawn);
                              update();
                            })}
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        disabled={busy}
                        mix={on("click", () => {
                          void saveSpawn();
                        })}
                      >
                        Save spawn
                      </button>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      );
    };
  },
);
