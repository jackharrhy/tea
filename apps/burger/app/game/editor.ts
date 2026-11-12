import {
  Application,
  Container,
  Sprite as PixiSprite,
  Texture,
  Graphics,
} from "pixi.js";
import { TILE_SIZE } from "@harrhy/burger-core";
import { sendPaint, type NetworkState } from "./network";
import { useGameStore } from "../store";

export const canEnterPaintMode = (
  user: { isAdmin: boolean },
  myZoneCells: Set<string>,
): boolean => {
  if (user.isAdmin) return true;
  return myZoneCells.size > 0;
};

export const canPaintCell = (
  user: { isAdmin: boolean },
  myZoneCells: Set<string>,
  key: string,
): boolean => {
  if (user.isAdmin) return true;
  return myZoneCells.has(key);
};

export type CatalogEntry = {
  id: number;
  type: string;
  src_x: number;
  src_y: number;
  label: string;
};

export type EditorState = {
  active: boolean;
  selectedTileId: number;
  catalog: CatalogEntry[];
  // The user's curated palette as catalog ids. Drives slot rendering, hotkey
  // selection, and wheel scrolling. Empty palette = no slots, but the user
  // can still paint with whatever selectedTileId resolves to.
  palette: number[];
  paletteEntries: CatalogEntry[];
  cursorX: number;
  cursorY: number;
  cursorSprite: PixiSprite | null;
  cursorOutline: Graphics | null;
  paletteContainer: Container | null;
  paletteSlots: Array<{ sprite: PixiSprite; outline: Graphics }>;
  isPainting: boolean;
  paintErase: boolean;
  lastPaintedKey: string | null;
  // Per-cell paint permission check. Captured from InitEditorOptions at init
  // time so updateEditor can tint the cursor red over forbidden cells without
  // needing access to opts. Defaults to () => true (admin-equivalent).
  getCanPaintCell: (key: string) => boolean;
};

const SLOT_SIZE = 40;
const SLOT_PADDING = 4;

const positionPalette = (state: EditorState, app: Application): void => {
  if (!state.paletteContainer) return;
  state.paletteContainer.x = 8;
  state.paletteContainer.y = app.screen.height - SLOT_SIZE - 8;
};

const selectTile = (state: EditorState, tileId: number): void => {
  state.selectedTileId = tileId;
  state.paletteSlots.forEach((slot, i) => {
    slot.outline.visible = state.paletteEntries[i]?.id === tileId;
  });
  useGameStore.getState().setSelectedTileId(tileId);
};

const paintAtCursor = (state: EditorState, network: NetworkState): void => {
  const key = `${state.cursorX},${state.cursorY}`;
  if (key === state.lastPaintedKey) return;
  state.lastPaintedKey = key;
  sendPaint(
    network,
    state.cursorX,
    state.cursorY,
    state.paintErase ? null : state.selectedTileId,
  );
};

// Resolve palette ids to catalog entries, dropping any ids that no longer
// exist in the catalog (e.g. after a tile was deleted server-side).
const resolvePaletteEntries = (
  ids: number[],
  catalog: CatalogEntry[],
): CatalogEntry[] => {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return ids
    .map((id) => byId.get(id))
    .filter((e): e is CatalogEntry => e !== undefined);
};

// Tear down existing slots and rebuild from state.paletteEntries. Callable
// at init and again whenever the palette changes (see setPalette below).
const rebuildPalette = (
  state: EditorState,
  textures: Record<number, Texture>,
): void => {
  if (!state.paletteContainer) return;
  state.paletteContainer.removeChildren();
  state.paletteSlots = [];

  state.paletteEntries.forEach((entry, i) => {
    const tex = textures[entry.id];
    if (!tex) return;
    const slotBg = new Graphics();
    slotBg.rect(0, 0, SLOT_SIZE, SLOT_SIZE);
    // Pixi Graphics.fill is a paint method, not Array.fill.
    // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type
    slotBg.fill({ color: 0x222222 });
    slotBg.x = i * (SLOT_SIZE + SLOT_PADDING);
    slotBg.y = 0;
    slotBg.eventMode = "static";
    slotBg.on("pointertap", () => selectTile(state, entry.id));
    state.paletteContainer!.addChild(slotBg);

    const sprite = new PixiSprite(tex);
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    sprite.x = slotBg.x + (SLOT_SIZE - TILE_SIZE) / 2;
    sprite.y = slotBg.y + (SLOT_SIZE - TILE_SIZE) / 2;
    state.paletteContainer!.addChild(sprite);

    const slotOutline = new Graphics();
    slotOutline
      .rect(0, 0, SLOT_SIZE, SLOT_SIZE)
      .stroke({ color: 0xffffff, width: 2 });
    slotOutline.x = slotBg.x;
    slotOutline.y = slotBg.y;
    slotOutline.visible = entry.id === state.selectedTileId;
    state.paletteContainer!.addChild(slotOutline);

    state.paletteSlots.push({ sprite, outline: slotOutline });
  });
};

// Apply a new palette to the editor: resolve entries, rebuild slot UI, and
// shift the selected tile if it's no longer in the palette.
export const setPalette = (
  state: EditorState,
  ids: number[],
  textures: Record<number, Texture>,
): void => {
  state.palette = ids;
  state.paletteEntries = resolvePaletteEntries(ids, state.catalog);
  if (
    state.paletteEntries.length > 0 &&
    !state.paletteEntries.find((e) => e.id === state.selectedTileId)
  ) {
    selectTile(state, state.paletteEntries[0]!.id);
  }
  rebuildPalette(state, textures);
};

// Paint-mode signal. `tile` = tile-paint editor active, `zone` = zone-paint
// overlay active, `none` = both off. The two modes are mutually exclusive;
// the editor toggles its own `state.active` and notifies the caller so the
// zones overlay can be flipped in lockstep.
type PaintMode = "tile" | "zone" | "none";

export type InitEditorOptions = {
  signal?: AbortSignal;
  onTogglePaintMode?: (mode: PaintMode) => void;
  // Called when the user tries to enter paint mode. If returns false, entry
  // is blocked silently. Defaults to "always allow" if omitted.
  getCanEnterPaintMode?: () => boolean;
  // Called per cursor cell to decide cursor tint. If returns false, cursor
  // shows red tint + red outline. Defaults to "always allow" if omitted.
  getCanPaintCell?: (key: string) => boolean;
};

export const initEditor = (
  app: Application,
  catalog: CatalogEntry[],
  textures: Record<number, Texture>,
  network: NetworkState,
  mainContainer: Container,
  getCamera: () => { x: number; y: number },
  getZoom: () => number,
  initialPalette: number[],
  opts: InitEditorOptions = {},
): EditorState => {
  const paletteEntries = resolvePaletteEntries(initialPalette, catalog);
  const initialSelected = paletteEntries[0]?.id ?? catalog[0]?.id ?? 1;
  const state: EditorState = {
    active: false,
    selectedTileId: initialSelected,
    catalog,
    palette: initialPalette,
    paletteEntries,
    cursorX: 0,
    cursorY: 0,
    cursorSprite: null,
    cursorOutline: null,
    paletteContainer: null,
    paletteSlots: [],
    isPainting: false,
    paintErase: false,
    lastPaintedKey: null,
    getCanPaintCell: opts.getCanPaintCell ?? (() => true),
  };

  // Cursor preview lives inside the world (mainContainer) so it shows at
  // world coords with the camera transform applied. Anchor 0.5 matches the
  // existing tile sprite convention (Position is the tile center).
  const initialTexture = textures[state.selectedTileId];
  if (initialTexture) {
    const cursorSprite = new PixiSprite(initialTexture);
    cursorSprite.width = TILE_SIZE;
    cursorSprite.height = TILE_SIZE;
    cursorSprite.anchor.set(0.5);
    cursorSprite.alpha = 0.5;
    cursorSprite.visible = false;
    state.cursorSprite = cursorSprite;
    mainContainer.addChild(cursorSprite);
  }

  const outline = new Graphics();
  outline.visible = false;
  state.cursorOutline = outline;
  mainContainer.addChild(outline);

  // Palette: screen-fixed container, drawn on top of the main world.
  const paletteLayer = new Container();
  paletteLayer.visible = false;
  state.paletteContainer = paletteLayer;
  app.stage.addChild(paletteLayer);

  rebuildPalette(state, textures);

  positionPalette(state, app);

  // Toggle edit mode with `e` (or Tab).
  window.addEventListener(
    "keydown",
    (e) => {
      // Don't hijack keys while the user is typing in a form field. Without
      // this, pressing "e" in the atlas tool's label input would toggle paint
      // mode (and swallow the character). Same trick the debug-window hotkey
      // uses in WindowManager.
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (e.key === "Escape" && state.active) {
        e.preventDefault();
        state.active = false;
        paletteLayer.visible = false;
        if (state.cursorSprite && state.cursorOutline) {
          state.cursorSprite.visible = false;
          state.cursorOutline.visible = false;
        }
        useGameStore.getState().setEditorActive(false);
        opts.onTogglePaintMode?.("none");
        return;
      }

      if (e.key === "e" || e.key === "Tab") {
        e.preventDefault();
        const goingActive = !state.active;
        // Gate entry on the caller's permission check (non-admin without zones,
        // etc). Silently no-op when blocked. Exit is always allowed.
        if (goingActive && opts.getCanEnterPaintMode?.() === false) {
          return;
        }
        state.active = goingActive;
        paletteLayer.visible = state.active;
        if (!state.active && state.cursorSprite && state.cursorOutline) {
          state.cursorSprite.visible = false;
          state.cursorOutline.visible = false;
        }
        useGameStore.getState().setEditorActive(state.active);
        // Tile-paint mode toggles itself; tell the caller so the zones
        // overlay can switch off when tile mode turns on (mutual exclusion).
        opts.onTogglePaintMode?.(state.active ? "tile" : "none");
        return;
      }
      if (e.key === "z") {
        e.preventDefault();
        // `z` always enters zone-paint mode and forces tile-paint off. Hide
        // the tile cursor/palette so the two modes don't visually overlap.
        if (state.active) {
          state.active = false;
          paletteLayer.visible = false;
          if (state.cursorSprite && state.cursorOutline) {
            state.cursorSprite.visible = false;
            state.cursorOutline.visible = false;
          }
          useGameStore.getState().setEditorActive(false);
        }
        opts.onTogglePaintMode?.("zone");
        return;
      }
      if (state.active) {
        const num = parseInt(e.key, 10);
        if (
          !Number.isNaN(num) &&
          num >= 1 &&
          num <= 9 &&
          state.paletteEntries[num - 1]
        ) {
          selectTile(state, state.paletteEntries[num - 1]!.id);
        }
      }
    },
    { signal: opts.signal },
  );

  // Returns true if the screen-space point (canvas-local) is inside the
  // pixi palette strip. The palette renders inside the canvas (not DOM), so
  // elementFromPoint always returns the canvas for palette clicks — we have
  // to AABB-test against the palette container ourselves to avoid the
  // double-fire (slot's pointertap selects the tile + canvas mousedown
  // paints behind it).
  const isOverPalette = (canvasX: number, canvasY: number): boolean => {
    const palette = state.paletteContainer;
    if (!palette || !palette.visible) return false;
    const w = state.paletteEntries.length * (SLOT_SIZE + SLOT_PADDING);
    const h = SLOT_SIZE;
    return (
      canvasX >= palette.x &&
      canvasX < palette.x + w &&
      canvasY >= palette.y &&
      canvasY < palette.y + h
    );
  };

  // Mouse position → snapped tile-cell center (paint convention is center).
  // Hide the cursor preview when the pointer leaves the canvas (e.g. over
  // a DOM overlay) so it doesn't look like a stale paint cursor.
  app.canvas.addEventListener(
    "mousemove",
    (e) => {
      if (!state.active) return;
      const rect = app.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      // Skip if a DOM overlay is over the cursor — keeps the preview from
      // updating to coords under the overlay, and stops paint-while-dragging
      // from continuing if you happen to hold a button while crossing into a
      // window. Same gate for the in-canvas palette strip.
      const topmost = document.elementFromPoint(e.clientX, e.clientY);
      if (topmost !== app.canvas || isOverPalette(mouseX, mouseY)) {
        state.isPainting = false;
        return;
      }
      const cam = getCamera();
      const zoom = getZoom();
      const worldX = (mouseX - app.screen.width / 2) / zoom + cam.x;
      const worldY = (mouseY - app.screen.height / 2) / zoom + cam.y;
      const halfTile = TILE_SIZE / 2;
      state.cursorX = Math.floor(worldX / TILE_SIZE) * TILE_SIZE + halfTile;
      state.cursorY = Math.floor(worldY / TILE_SIZE) * TILE_SIZE + halfTile;
      if (state.isPainting) paintAtCursor(state, network);
    },
    { signal: opts.signal },
  );

  app.canvas.addEventListener(
    "mousedown",
    (e) => {
      if (!state.active) return;
      // Bail if a DOM overlay is on top of the click (taskbar, window) or if
      // the click landed on the in-canvas palette strip. The palette has its
      // own pointertap handler for selecting tiles; we don't want to paint
      // the world tile underneath when the user is just picking a slot.
      const topmost = document.elementFromPoint(e.clientX, e.clientY);
      if (topmost !== app.canvas) return;
      const rect = app.canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      if (isOverPalette(canvasX, canvasY)) return;
      e.preventDefault();
      if (e.button === 0) {
        state.isPainting = true;
        state.paintErase = false;
        paintAtCursor(state, network);
      } else if (e.button === 2) {
        state.isPainting = true;
        state.paintErase = true;
        paintAtCursor(state, network);
      }
    },
    { signal: opts.signal },
  );

  window.addEventListener(
    "mouseup",
    () => {
      state.isPainting = false;
      state.lastPaintedKey = null;
    },
    { signal: opts.signal },
  );

  app.canvas.addEventListener(
    "contextmenu",
    (e) => {
      if (state.active) e.preventDefault();
    },
    { signal: opts.signal },
  );

  app.canvas.addEventListener(
    "wheel",
    (e) => {
      if (!state.active) return;
      e.preventDefault();
      if (state.paletteEntries.length === 0) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      const idx = state.paletteEntries.findIndex(
        (c) => c.id === state.selectedTileId,
      );
      const next =
        (idx + dir + state.paletteEntries.length) % state.paletteEntries.length;
      const entry = state.paletteEntries[next];
      if (entry) selectTile(state, entry.id);
    },
    { signal: opts.signal },
  );

  return state;
};

// Programmatic exit from paint mode. Mirrors what the Escape key handler
// does to the editor's visible state, but skips the keyboard plumbing —
// used by `index.ts` to auto-exit non-admins when their last zone cell
// disappears. The caller is responsible for updating the React store (via
// `setEditorActive(false)`) and any external overlays it owns (perimeter,
// zones, etc).
export const exitPaintMode = (state: EditorState): void => {
  state.active = false;
  if (state.paletteContainer) {
    state.paletteContainer.visible = false;
  }
  if (state.cursorSprite) {
    state.cursorSprite.visible = false;
  }
  if (state.cursorOutline) {
    state.cursorOutline.visible = false;
  }
};

export const updateEditor = (
  state: EditorState,
  textures: Record<number, Texture>,
  app: Application,
): void => {
  // Reposition the palette every tick. pixi's resize is rAF-deferred via the
  // ResizePlugin's queueResize, so reading app.screen.height in a window
  // resize listener returns the stale (pre-resize) value. Doing it here
  // runs after pixi has settled the new screen size.
  positionPalette(state, app);

  if (!state.cursorSprite || !state.cursorOutline) return;
  if (!state.active) {
    state.cursorSprite.visible = false;
    state.cursorOutline.visible = false;
    return;
  }

  // Keep cursor texture in sync with selectedTileId.
  const tex = textures[state.selectedTileId];
  if (tex && state.cursorSprite.texture !== tex) {
    state.cursorSprite.texture = tex;
  }
  // cursorX/Y are the cell center (paint convention). Sprite has anchor 0.5
  // so positioning at the center matches existing tile rendering.
  state.cursorSprite.x = state.cursorX;
  state.cursorSprite.y = state.cursorY;
  state.cursorSprite.visible = true;

  // Visual feedback for non-admin paint mode: red tint + red outline over
  // cells the user can't paint. Admins (and the default no-op check) always
  // see the standard white cursor.
  const key = `${state.cursorX},${state.cursorY}`;
  const allowed = state.getCanPaintCell(key);
  const color = allowed ? 0xffffff : 0xff4040;
  state.cursorSprite.tint = color;

  // Outline is a top-left-anchored rect; offset back by half a tile so it
  // surrounds the cell that the cursor sprite occupies.
  const halfTile = TILE_SIZE / 2;
  state.cursorOutline.clear();
  state.cursorOutline
    .rect(
      state.cursorX - halfTile,
      state.cursorY - halfTile,
      TILE_SIZE,
      TILE_SIZE,
    )
    .stroke({ color, width: 1 });
  state.cursorOutline.visible = true;
};
