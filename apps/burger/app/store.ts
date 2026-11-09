import { create } from "zustand";
import { eden } from "./eden";
import type { Me } from "./types";

export type DebugMetrics = {
  tickrate: number;
  lag: number;
  jitter: number;
  updatesHz: number;
  bytesSentPerSec: number;
  bytesReceivedPerSec: number;
};

export type EditorPublicState = {
  active: boolean;
  selectedTileId: number;
};

// Window manager. Each window registers an entry; open/close/focus/move are
// all session-state (no localStorage). Keeps the manager dumb — windows
// register themselves via WindowManager via `register*` actions; chrome
// reads `windows` map to render.
export type WindowState = {
  id: string;
  title: string;
  open: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
};

export type SpawnZone = { x: number; y: number; w: number; h: number };

// One row from `GET /api/zones`. Admin-only — non-admins receive only the
// flat `myZoneCells` set computed server-side, not this metadata.
export type ZoneEntry = {
  id: number;
  name: string;
  member_user_ids: string[];
  cell_count: number;
};

// Zones state is grouped because the 4 sub-fields are tightly coupled
// (admin list + per-zone cells + selection; non-admin paintable cell set).
// Setters use `{ ...s.zones, ... }` to update a single field at a time —
// mirrors the slice pattern recommended in the plan.
type ZonesSlice = {
  // Admin: full zone list + per-zone cells, indexed by zone id. Non-admins
  // never receive these — for them both stay at their initial empty values.
  list: ZoneEntry[];
  cellsByZone: Map<number, [number, number][]>;
  selectedId: number | null;
  // Non-admin: union of cells across every zone the user belongs to,
  // keyed as `"x,y"` strings so paint-time membership checks are O(1).
  myZoneCells: Set<string>;
};

const zonesSlice = (): ZonesSlice => ({
  list: [],
  cellsByZone: new Map(),
  selectedId: null,
  myZoneCells: new Set(),
});

type GameStore = {
  user: Me | null;
  editor: EditorPublicState | null;
  metrics: DebugMetrics;
  windows: Record<string, WindowState>;
  // The spawn zone the admin is currently editing. When non-null, the pixi
  // SpawnOverlay draws a rectangle at these coords. Set to null when the
  // window closes or after a successful save (the saved value becomes the
  // new server-side truth, no preview needed).
  spawnDraft: SpawnZone | null;
  // The admin's curated paint palette: ordered catalog ids, max 9. Persisted
  // server-side per user; the pixi editor reads from this to render slots.
  palette: number[];
  // Grouped zones state — see ZonesSlice for layout.
  zones: ZonesSlice;
  // Lag/jitter sliders feed back into the live network state. The game's
  // metrics system reads these every tick.
  setLag: (ms: number) => void;
  setJitter: (ms: number) => void;
  setSpawnDraft: (zone: SpawnZone | null) => void;
  setPalette: (ids: number[]) => void;

  setZones: (list: ZoneEntry[]) => void;
  setZoneCells: (cellsByZone: Map<number, [number, number][]>) => void;
  setSelectedZone: (selectedId: number | null) => void;
  setMyZoneCells: (cells: [number, number][]) => void;

  setUser: (u: Me | null) => void;
  setEditor: (e: EditorPublicState | null) => void;
  setEditorActive: (active: boolean) => void;
  setSelectedTileId: (id: number) => void;
  setMetrics: (m: Partial<DebugMetrics>) => void;

  registerWindow: (
    id: string,
    init: Omit<WindowState, "id" | "z" | "open"> & { open?: boolean },
  ) => void;
  openWindow: (id: string) => void;
  closeWindow: (id: string) => void;
  toggleWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  setWindowPos: (id: string, x: number, y: number) => void;
  setWindowSize: (id: string, w: number, h: number) => void;
};

export const useGameStore = create<GameStore>((set) => ({
  user: null,
  editor: null,
  metrics: {
    tickrate: 0,
    lag: 0,
    jitter: 0,
    updatesHz: 0,
    bytesSentPerSec: 0,
    bytesReceivedPerSec: 0,
  },
  windows: {},
  spawnDraft: null,
  palette: [],
  zones: zonesSlice(),

  setLag: (lag) =>
    set((s) => ({ metrics: { ...s.metrics, lag: Math.max(0, lag) } })),
  setJitter: (jitter) =>
    set((s) => ({ metrics: { ...s.metrics, jitter: Math.max(0, jitter) } })),
  setSpawnDraft: (spawnDraft) => set({ spawnDraft }),
  setPalette: (palette) => set({ palette }),

  setZones: (list) => set((s) => ({ zones: { ...s.zones, list } })),
  setZoneCells: (cellsByZone) =>
    set((s) => ({ zones: { ...s.zones, cellsByZone } })),
  setSelectedZone: (selectedId) =>
    set((s) => ({ zones: { ...s.zones, selectedId } })),
  setMyZoneCells: (cells) =>
    set((s) => ({
      zones: {
        ...s.zones,
        // Convert to `"x,y"` keys so the paint hot path can membership-check
        // in O(1) without re-stringifying on every cell hover.
        myZoneCells: new Set(cells.map(([x, y]) => `${x},${y}`)),
      },
    })),

  setUser: (user) => set({ user }),
  setEditor: (editor) => set({ editor }),
  setEditorActive: (active) =>
    set((s) => (s.editor ? { editor: { ...s.editor, active } } : s)),
  setSelectedTileId: (selectedTileId) =>
    set((s) => (s.editor ? { editor: { ...s.editor, selectedTileId } } : s)),
  setMetrics: (m) => set((s) => ({ metrics: { ...s.metrics, ...m } })),

  registerWindow: (id, init) =>
    set((s) => {
      // Don't clobber an existing entry — registration is idempotent so
      // a Game.tsx remount under StrictMode keeps the user's window state.
      if (s.windows[id]) return s;
      const maxZ = Object.values(s.windows).reduce(
        (m, w) => (w.z > m ? w.z : m),
        0,
      );
      return {
        windows: {
          ...s.windows,
          [id]: {
            id,
            title: init.title,
            open: init.open ?? false,
            x: init.x,
            y: init.y,
            w: init.w,
            h: init.h,
            z: maxZ + 1,
          },
        },
      };
    }),
  openWindow: (id) =>
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      const maxZ = Object.values(s.windows).reduce(
        (m, x) => (x.z > m ? x.z : m),
        0,
      );
      return {
        windows: {
          ...s.windows,
          [id]: { ...w, open: true, z: maxZ + 1 },
        },
      };
    }),
  closeWindow: (id) =>
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      return { windows: { ...s.windows, [id]: { ...w, open: false } } };
    }),
  toggleWindow: (id) =>
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      const maxZ = Object.values(s.windows).reduce(
        (m, x) => (x.z > m ? x.z : m),
        0,
      );
      return {
        windows: {
          ...s.windows,
          [id]: { ...w, open: !w.open, z: w.open ? w.z : maxZ + 1 },
        },
      };
    }),
  focusWindow: (id) =>
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      const maxZ = Object.values(s.windows).reduce(
        (m, x) => (x.z > m ? x.z : m),
        0,
      );
      if (w.z === maxZ) return s; // already on top
      return { windows: { ...s.windows, [id]: { ...w, z: maxZ + 1 } } };
    }),
  setWindowPos: (id, x, y) =>
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      return { windows: { ...s.windows, [id]: { ...w, x, y } } };
    }),
  setWindowSize: (id, w, h) =>
    set((s) => {
      const win = s.windows[id];
      if (!win) return s;
      return { windows: { ...s.windows, [id]: { ...win, w, h } } };
    }),
}));

// Admin-only fetch. Pulls the zone list and the per-zone cell map in
// parallel and writes both into the store. Called on initial admin window
// open and on every `ZONES_UPDATED` WS message. Non-admins hit the 403 path
// and end up with empty list/cells, which is the harmless default.
export const refetchZones = async (): Promise<void> => {
  const [listRes, cellsRes] = await Promise.all([
    eden.api.zones.get(),
    eden.api.zones["all-cells"].get(),
  ]);

  const listData = listRes.data as { zones?: ZoneEntry[] } | null;
  const cellsData = cellsRes.data as {
    zones?: { id: number; cells: [number, number][] }[];
  } | null;

  const list = listData?.zones ?? [];
  const cellsByZone = new Map<number, [number, number][]>();
  for (const z of cellsData?.zones ?? []) {
    cellsByZone.set(z.id, z.cells);
  }

  const { setZones, setZoneCells } = useGameStore.getState();
  setZones(list);
  setZoneCells(cellsByZone);
};
