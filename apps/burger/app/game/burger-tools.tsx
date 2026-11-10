import { clientEntry, css, on, ref, type Handle } from "remix/component";
import { AtlasEditor } from "../atlas/editor";
import {
  useGameStore,
  type SpawnZone,
  type WindowState,
  type ZoneEntry,
} from "../store";
import type { Me } from "../types";
import { BurgerWindow } from "./window";

type Panel = "atlas" | "palette" | "zones" | "bots" | "spawn";
type Tile = { id: number; label: string; src_x: number; src_y: number };
type UserOption = { id: string; display_name: string | null };

const taskbar = css({
  position: "fixed",
  top: "8px",
  right: "8px",
  zIndex: 1000,
  display: "flex",
  flexWrap: "wrap",
  gap: "4px",
  maxWidth: "calc(100vw - 16px)",
  font: "12px/1.4 monospace",
  "& button": {
    padding: "4px 10px",
    border: "1px solid #444",
    borderRadius: "4px",
    background: "#1a1a1ae6",
    color: "#ddd",
    cursor: "pointer",
  },
  "& button:hover, & button[aria-pressed='true']": {
    background: "#2a2a2ae6",
    borderColor: "#888",
    color: "#fff",
  },
});
const playerTaskbar = css({ right: "auto", left: "8px" });
const panelContent = css({
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  height: "100%",
  padding: "8px",
  "& p": { margin: "0" },
  "& input": { maxWidth: "100%" },
});
const tilesStyle = css({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, 64px)",
  alignContent: "start",
  gap: "8px",
  flex: "1",
  overflowY: "auto",
});
const tileStyle = css({
  display: "grid",
  justifyItems: "center",
  gap: "2px",
  width: "64px",
  height: "54px",
  padding: "2px",
  border: "2px solid #333",
  background: "#242a2c",
  color: "#ccc",
  fontSize: "10px",
  overflow: "hidden",
  "&[aria-pressed='true']": { borderColor: "#ffd966" },
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
export const BurgerTools = clientEntry(
  "file:///app/game/burger-tools.tsx#BurgerTools",
  function BurgerTools(handle: Handle) {
    let user: Me | null = null;
    let palette: number[] = [];
    let zones: ZoneEntry[] = [];
    let myZoneCount = 0;
    let windows: Record<string, WindowState> = {};
    let registered = false;
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
    async function togglePanel(next: Panel) {
      const signal = activeSignal;
      if (!signal) return;
      error = "";
      useGameStore.getState().toggleWindow(next);
      if (!useGameStore.getState().windows[next]?.open) {
        if (next === "spawn") useGameStore.getState().setSpawnDraft(null);
        return;
      }
      if (next === "atlas") return;
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
      const panel = (id: Panel) =>
        windows[id]?.open ? (
          <BurgerWindow state={windows[id]}>
            {id === "atlas" ? (
              <AtlasEditor embedded />
            ) : (
              <div mix={panelContent}>
                {error && <p role="alert">{error}</p>}
                {id === "palette" && (
                  <>
                    <p>
                      Right-click a tile to add or remove it from your palette (
                      {palette.length}/9).
                    </p>
                    <div mix={tilesStyle}>
                      {tiles.map((tile) => (
                        <button
                          type="button"
                          title={tile.label}
                          aria-label={tile.label}
                          aria-pressed={palette.includes(tile.id)}
                          disabled={busy}
                          mix={[
                            tileStyle,
                            on("click", () => void toggleTile(tile.id)),
                            on("contextmenu", (event) => {
                              event.preventDefault();
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
                {id === "zones" && user?.isAdmin && (
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
                          mix={on("click", () =>
                            useGameStore.getState().setSelectedZone(zone.id),
                          )}
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
                              mix={on(
                                "change",
                                () => void toggleMember(selected, person.id),
                              )}
                            />
                            {person.display_name ?? person.id}
                          </label>
                        ))}
                      </>
                    )}
                  </>
                )}
                {id === "bots" && user?.isAdmin && (
                  <>
                    <p>Active bots: {bots ?? "…"}</p>
                    <button
                      type="button"
                      disabled={busy}
                      mix={on("click", () => void resetBots())}
                    >
                      Reset to spawn
                    </button>
                  </>
                )}
                {id === "spawn" && user?.isAdmin && spawn && (
                  <>
                    {(["x", "y", "w", "h"] as const).map((key) => (
                      <label mix={row}>
                        {key.toUpperCase()}
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
                      mix={on("click", () => void saveSpawn())}
                    >
                      Save spawn
                    </button>
                  </>
                )}
              </div>
            )}
          </BurgerWindow>
        ) : null;
      return (
        <div
          mix={ref((_node, signal) => {
            activeSignal = signal;
            const sync = () => {
              const state = useGameStore.getState();
              user = state.user;
              if (user && !registered) {
                registered = true;
                const register = state.registerWindow;
                if (user.isAdmin) {
                  register("atlas", {
                    title: "Atlas",
                    x: 80,
                    y: 80,
                    w: Math.max(320, Math.min(960, innerWidth - 160)),
                    h: Math.max(240, Math.min(640, innerHeight - 160)),
                  });
                  register("spawn", {
                    title: "Spawn",
                    x: 80,
                    y: 80,
                    w: 280,
                    h: 260,
                  });
                  register("bots", {
                    title: "Bots",
                    x: 80,
                    y: 80,
                    w: 240,
                    h: 200,
                  });
                  register("zones", {
                    title: "Zones",
                    x: 20,
                    y: 60,
                    w: 320,
                    h: 480,
                  });
                }
                register("palette", {
                  title: "Palette",
                  x: 60,
                  y: 100,
                  w: 380,
                  h: 480,
                });
              }
              palette = state.palette;
              zones = state.zones.list;
              myZoneCount = state.zones.myZoneCells.size;
              selectedZone = state.zones.selectedId;
              windows = useGameStore.getState().windows;
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
              <div
                mix={[taskbar, !user.isAdmin && playerTaskbar]}
                role="toolbar"
                aria-label="Burger tools"
              >
                {(user.isAdmin
                  ? ["atlas", "spawn", "bots", "zones", "palette"]
                  : myZoneCount > 0
                    ? ["palette"]
                    : []
                ).map((id) => (
                  <button
                    type="button"
                    aria-pressed={windows[id]?.open ?? false}
                    mix={on("click", () => void togglePanel(id as Panel))}
                  >
                    {windows[id]?.title ?? id[0].toUpperCase() + id.slice(1)}
                  </button>
                ))}
                <form method="post" action="/auth/logout">
                  <button type="submit">Sign out</button>
                </form>
              </div>
              {user.isAdmin && panel("atlas")}
              {user.isAdmin && panel("spawn")}
              {user.isAdmin && panel("bots")}
              {user.isAdmin && panel("zones")}
              {panel("palette")}
            </>
          )}
        </div>
      );
    };
  },
);
