import "../style.css";

import {
  sharedComponents,
  PLAYER_SIZE,
  TILE_SIZE,
  applyInputToVelocity,
  moveAndSlide,
  lerp,
  type InputCmd,
} from "@harrhy/burger-core";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite as PixiSprite,
  Text as PixiText,
  Rectangle,
  Texture,
  TextureSource,
} from "pixi.js";
import {
  createWorld,
  query,
  addComponent,
  observe,
  onAdd,
  onRemove,
} from "bitecs";
import {
  setupSocket,
  sendInputs,
  type PositionSnapshot,
  type NetworkState,
  type PlayerIdentity,
} from "./network";
import {
  CAMERA_LERP_FACTOR,
  DEADZONE_WIDTH,
  ERROR_DECAY_RATE,
  INTERP_DELAY,
  ZOOM,
} from "./consts";
import debugFactory from "debug";
import type { Me } from "../types";
import {
  canEnterPaintMode,
  canPaintCell,
  exitPaintMode,
  initEditor,
  setPalette as setEditorPalette,
  updateEditor,
  type EditorState,
  type CatalogEntry,
} from "./editor";
import {
  beginZoneStroke,
  endZoneStroke,
  extendZoneStroke,
  initZonesGame,
  setZonesActive,
  setZonesData,
  type ZonesGameState,
} from "./zones";
import {
  initPerimeter,
  setPerimeterCells,
  setPerimeterVisible,
  type PerimeterState,
} from "./zones-perimeter";
import { useGameStore } from "../store";

const debug = debugFactory("burger:client");

const showDebug = import.meta.env.DEV;

const makeWorld = () =>
  createWorld({
    components: {
      ...sharedComponents,
      Input: [] as {
        up: boolean;
        down: boolean;
        left: boolean;
        right: boolean;
        interact: boolean;
        interactPressed: boolean;
      }[],
      Sprite: [] as (PixiSprite | undefined)[],
      NameText: [] as (PixiText | undefined)[],
      DebugText: [] as (PixiText | undefined)[],
      RenderPosition: { x: [] as number[], y: [] as number[] },
      PositionHistory: [] as PositionSnapshot[][],
    },
    time: {
      delta: 0,
      elapsed: 0,
      previousTick: performance.now(),
    },
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    typeIdToAtlasSrc: {} as Record<number, [number, number]>,
  });

export type World = ReturnType<typeof makeWorld>;

type Context = {
  world: World;
  app: Application;
  containers: {
    main: Container;
    tiles: Container;
    entities: Container;
    debug: Container;
  };
  // Persistent pixi nodes used by admin/debug systems.
  overlays: {
    spawn: Graphics;
  };
  assets: Awaited<ReturnType<typeof loadAssets>>;
  input: { keys: Record<string, boolean>; prevInteract: boolean };
  me: PlayerIdentity;
  network: NetworkState;
  camera: { x: number; y: number; initialized: boolean };
  metrics: {
    updatesHz: number;
    updatesCount: number;
    lastUpdateTime: number;
    lastBytesSent: number;
    lastBytesReceived: number;
    bytesSentPerSec: number;
    bytesReceivedPerSec: number;
    serverTicksCount: number;
    lastServerTickTime: number;
    serverTickrate: number;
  };
  debugMetrics: {
    updatesHz: number;
    tickrate: number;
    bytesSentPerSec: number;
    bytesReceivedPerSec: number;
    lag: number;
    jitter: number;
  };
  user: Me;
  editor: EditorState | null;
  zones: ZonesGameState;
  perimeter: PerimeterState;
};

declare global {
  interface Window {
    context: Context;
  }
}

const setupPlayerObserver = (context: Context) => {
  const { world, assets, containers } = context;
  const {
    Player,
    Sprite,
    NameText,
    DebugText,
    Velocity,
    RenderPosition,
    PositionHistory,
  } = world.components;

  observe(world, onAdd(Player), (eid) => {
    addComponent(world, eid, Sprite);
    const sprite = new PixiSprite(assets.player);
    sprite.width = PLAYER_SIZE;
    sprite.height = PLAYER_SIZE;
    sprite.anchor.set(0.5);
    containers.entities.addChild(sprite);
    Sprite[eid] = sprite;

    addComponent(world, eid, Velocity);
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;

    addComponent(world, eid, RenderPosition);
    RenderPosition.x[eid] = 0;
    RenderPosition.y[eid] = 0;

    addComponent(world, eid, PositionHistory);
    PositionHistory[eid] = [];

    // Player nametag (always on; renders the account display name above the head).
    addComponent(world, eid, NameText);
    const nameText = new PixiText({
      text: "",
      style: { fontFamily: "monospace", fontSize: 10, fill: 0xffffff },
      // Rasterise at the on-screen pixel size so the glyph atlas stays
      // crisp inside the ZOOM-scaled main container.
      resolution: ZOOM * (window.devicePixelRatio || 1),
    });
    nameText.anchor.set(0.5, 1);
    containers.debug.addChild(nameText);
    NameText[eid] = nameText;

    if (showDebug) {
      addComponent(world, eid, DebugText);
      const debugText = new PixiText({
        text: "",
        style: { fontFamily: "monospace", fontSize: 12, fill: 0x000000 },
        resolution: ZOOM * (window.devicePixelRatio || 1),
      });
      debugText.anchor.set(0.5, 0);
      containers.debug.addChild(debugText);
      DebugText[eid] = debugText;
    }

    debug("player added: eid=%s, name=%s", eid, Player.name[eid]);
  });

  observe(world, onRemove(Player), (eid) => {
    const sprite = Sprite[eid];
    if (sprite) {
      containers.entities.removeChild(sprite);
      sprite.destroy();
      Sprite[eid] = undefined;
    }

    const nameText = NameText[eid];
    if (nameText) {
      containers.debug.removeChild(nameText);
      nameText.destroy();
      NameText[eid] = undefined;
    }

    if (showDebug) {
      const debugText = DebugText[eid];
      if (debugText) {
        containers.debug.removeChild(debugText);
        debugText.destroy();
        DebugText[eid] = undefined;
      }
    }

    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;
    RenderPosition.x[eid] = 0;
    RenderPosition.y[eid] = 0;
    PositionHistory[eid] = [];

    debug("player removed: eid=%s", eid);
  });
};

// Tile sprites are created/destroyed by polling each frame. We can't create
// sprites inside `onAdd(Tile)` because the bitecs snapshot deserializer adds
// components first and then replays the SoA payload — so Position.x/y aren't
// populated yet when onAdd(Tile) fires. Instead, the tileSpriteSystem below
// runs every frame, creates a sprite for any Tile entity that doesn't yet
// have one (Position is guaranteed by then), and destroys orphaned sprites
// when entities are removed.
const tileSpriteSystem = ({ world, assets, containers }: Context) => {
  const { Tile, Position, Sprite } = world.components;

  // Add sprites for new tile entities.
  for (const eid of query(world, [Tile, Position])) {
    if (Sprite[eid]) continue;
    const tileId = Tile.type[eid]!;
    const texture = assets.tiles[tileId];
    if (!texture) {
      console.warn(`Missing tile texture for tileId=${tileId}`);
      continue;
    }

    addComponent(world, eid, Sprite);
    const sprite = new PixiSprite(texture);
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    sprite.anchor.set(0.5);
    sprite.x = Position.x[eid]!;
    sprite.y = Position.y[eid]!;
    containers.tiles.addChild(sprite);
    Sprite[eid] = sprite;
  }
};

// Destroy sprites for entities removed via the OBSERVER stream. Hook on
// onRemove(Tile) so erase paints are reflected immediately on screen.
const setupTileObserver = (context: Context) => {
  const { world, containers } = context;
  const { Tile, Sprite } = world.components;

  observe(world, onRemove(Tile), (eid) => {
    const sprite = Sprite[eid];
    if (sprite) {
      containers.tiles.removeChild(sprite);
      sprite.destroy();
      Sprite[eid] = undefined;
    }
  });
};

const timeSystem = ({ world }: Context) => {
  const { time } = world;
  const now = performance.now();
  time.delta = now - time.previousTick;
  time.elapsed += time.delta;
  time.previousTick = now;
};

const inputSystem = ({ world, input }: Context): void => {
  const { Player, Input } = world.components;
  const { keys } = input;
  const interactDown = keys[" "] || keys["space"] || false;
  const interactPressed = interactDown && !input.prevInteract;
  input.prevInteract = interactDown;

  for (const eid of query(world, [Player, Input])) {
    Input[eid] = {
      up: keys["w"] || keys["arrowup"] || false,
      down: keys["s"] || keys["arrowdown"] || false,
      left: keys["a"] || keys["arrowleft"] || false,
      right: keys["d"] || keys["arrowright"] || false,
      interact: interactDown,
      interactPressed,
    };
  }
};

const predictionSystem = ({ world, me, network }: Context): void => {
  const { Input, Velocity, Position } = world.components;
  const dt = world.time.delta;

  if (me.eid === null) return;
  const eid = me.eid;
  const input = Input[eid];
  if (!input) return;

  const newVel = applyInputToVelocity(
    Velocity.x[eid]!,
    Velocity.y[eid]!,
    input,
    dt,
  );
  Velocity.x[eid] = newVel.vx;
  Velocity.y[eid] = newVel.vy;

  const newPos = moveAndSlide(
    world,
    Position.x[eid]!,
    Position.y[eid]!,
    Velocity.x[eid]!,
    Velocity.y[eid]!,
    dt,
  );
  Position.x[eid] = newPos.x;
  Position.y[eid] = newPos.y;

  const cmd: InputCmd = {
    seq: network.inputSeq++,
    msec: dt,
    up: input.up,
    down: input.down,
    left: input.left,
    right: input.right,
    interact: input.interact,
  };
  network.pendingInputs.push(cmd);

  if (network.pendingInputs.length > 128) {
    network.pendingInputs.shift();
  }
};

const networkSendSystem = ({ network, me, metrics }: Context) => {
  sendInputs(network, me.eid, metrics);
};

const metricsSystem = ({ network, metrics, debugMetrics }: Context) => {
  const now = performance.now();

  if (now - metrics.lastUpdateTime >= 1000) {
    const deltaTime = (now - metrics.lastUpdateTime) / 1000;
    metrics.updatesHz = metrics.updatesCount;
    metrics.updatesCount = 0;
    metrics.bytesSentPerSec =
      (network.bytesSent - metrics.lastBytesSent) / deltaTime;
    metrics.lastBytesSent = network.bytesSent;
    metrics.bytesReceivedPerSec =
      (network.bytesReceived - metrics.lastBytesReceived) / deltaTime;
    metrics.lastBytesReceived = network.bytesReceived;
    metrics.lastUpdateTime = now;
  }

  if (now - metrics.lastServerTickTime >= 1000) {
    metrics.serverTickrate = metrics.serverTicksCount;
    metrics.serverTicksCount = 0;
    metrics.lastServerTickTime = now;
  }

  debugMetrics.updatesHz = metrics.updatesHz;
  debugMetrics.tickrate = metrics.serverTickrate;
  debugMetrics.bytesSentPerSec = Math.round(metrics.bytesSentPerSec);
  debugMetrics.bytesReceivedPerSec = Math.round(metrics.bytesReceivedPerSec);

  // Lag/jitter sliders live in the React store; pull them from there each
  // tick so changes from the debug window apply immediately.
  const storeMetrics = useGameStore.getState().metrics;
  debugMetrics.lag = storeMetrics.lag;
  debugMetrics.jitter = storeMetrics.jitter;
  network.lagMs = debugMetrics.lag;
  network.jitterMs = debugMetrics.jitter;

  // Mirror computed values back to the store so the debug window can render.
  useGameStore.getState().setMetrics({
    tickrate: debugMetrics.tickrate,
    updatesHz: debugMetrics.updatesHz,
    bytesSentPerSec: debugMetrics.bytesSentPerSec,
    bytesReceivedPerSec: debugMetrics.bytesReceivedPerSec,
  });
};

const errorDecaySystem = ({ network }: Context) => {
  const { predictionError } = network;
  predictionError.x *= 1 - ERROR_DECAY_RATE;
  predictionError.y *= 1 - ERROR_DECAY_RATE;
  if (Math.abs(predictionError.x) < 0.01) predictionError.x = 0;
  if (Math.abs(predictionError.y) < 0.01) predictionError.y = 0;
};

const interpolationSystem = ({ world, me, network }: Context) => {
  const { Position, Velocity, RenderPosition, PositionHistory } =
    world.components;
  const localEid = me.eid;
  const renderTime = performance.now() - INTERP_DELAY;

  for (const eid of query(world, [Position, RenderPosition, PositionHistory])) {
    if (eid === localEid) {
      RenderPosition.x[eid] = Position.x[eid]! + network.predictionError.x;
      RenderPosition.y[eid] = Position.y[eid]! + network.predictionError.y;
      continue;
    }

    const history = PositionHistory[eid];
    if (!history || history.length === 0) {
      RenderPosition.x[eid] = Position.x[eid]!;
      RenderPosition.y[eid] = Position.y[eid]!;
      continue;
    }

    const oldest = history[0]!;
    const newest = history[history.length - 1]!;

    if (renderTime >= newest.time) {
      const dt = renderTime - newest.time;
      RenderPosition.x[eid] = newest.x + Velocity.x[eid]! * dt;
      RenderPosition.y[eid] = newest.y + Velocity.y[eid]! * dt;
      continue;
    }

    if (renderTime <= oldest.time) {
      RenderPosition.x[eid] = oldest.x;
      RenderPosition.y[eid] = oldest.y;
      continue;
    }

    let p1 = oldest;
    let p2 = oldest;
    for (let i = 0; i < history.length - 1; i++) {
      const a = history[i]!;
      const b = history[i + 1]!;
      if (a.time <= renderTime && b.time >= renderTime) {
        p1 = a;
        p2 = b;
        break;
      }
    }

    const duration = p2.time - p1.time;
    const t = duration > 0 ? (renderTime - p1.time) / duration : 0;
    RenderPosition.x[eid] = lerp(p1.x, p2.x, t);
    RenderPosition.y[eid] = lerp(p1.y, p2.y, t);
  }
};

const cameraSystem = ({ world, app, containers, me, camera }: Context) => {
  if (me.eid === null) return;

  const { RenderPosition } = world.components;
  const px = RenderPosition.x[me.eid]!;
  const py = RenderPosition.y[me.eid]!;

  if (!camera.initialized) {
    camera.x = px;
    camera.y = py;
    camera.initialized = true;
  }

  let cameraTargetX = camera.x;
  let cameraTargetY = camera.y;

  if (px < camera.x - DEADZONE_WIDTH / 2) {
    cameraTargetX = px + DEADZONE_WIDTH / 2;
  } else if (px > camera.x + DEADZONE_WIDTH / 2) {
    cameraTargetX = px - DEADZONE_WIDTH / 2;
  }

  if (py < camera.y - DEADZONE_WIDTH / 2) {
    cameraTargetY = py + DEADZONE_WIDTH / 2;
  } else if (py > camera.y + DEADZONE_WIDTH / 2) {
    cameraTargetY = py - DEADZONE_WIDTH / 2;
  }

  camera.x = lerp(camera.x, cameraTargetX, CAMERA_LERP_FACTOR);
  camera.y = lerp(camera.y, cameraTargetY, CAMERA_LERP_FACTOR);

  containers.main.scale.set(ZOOM, ZOOM);
  containers.main.x = app.screen.width / 2 - camera.x * ZOOM;
  containers.main.y = app.screen.height / 2 - camera.y * ZOOM;
};

const spritesSystem = ({ world }: Context) => {
  const { RenderPosition, Sprite } = world.components;
  for (const eid of query(world, [RenderPosition, Sprite])) {
    const sprite = Sprite[eid];
    if (!sprite) continue;
    sprite.x = RenderPosition.x[eid]!;
    sprite.y = RenderPosition.y[eid]!;
  }
};

const nameSystem = ({ world }: Context) => {
  const { Player, RenderPosition, NameText } = world.components;

  for (const eid of query(world, [RenderPosition, NameText])) {
    const nameText = NameText[eid];
    if (!nameText) continue;

    const playerName = Player.name[eid];
    nameText.text = playerName ?? "";
    nameText.x = RenderPosition.x[eid]!;
    nameText.y = RenderPosition.y[eid]! - PLAYER_SIZE / 2 - 2;
  }
};

const debugSystem = ({ world }: Context) => {
  if (!showDebug) return;

  const { RenderPosition, Velocity, DebugText } = world.components;

  for (const eid of query(world, [RenderPosition, Velocity, DebugText])) {
    const debugText = DebugText[eid];
    if (!debugText) continue;

    const px = (RenderPosition.x[eid] ?? 0).toFixed(1);
    const py = (RenderPosition.y[eid] ?? 0).toFixed(1);
    const vx = (Velocity.x[eid] ?? 0).toFixed(2);
    const vy = (Velocity.y[eid] ?? 0).toFixed(2);

    debugText.text = `pos: (${px}, ${py})\nvel: (${vx}, ${vy})`;
    debugText.x = RenderPosition.x[eid]!;
    debugText.y = RenderPosition.y[eid]! + PLAYER_SIZE / 2 + 4;
  }
};

const editorSystem = (context: Context) => {
  if (!context.editor) return;
  updateEditor(context.editor, context.assets.tiles, context.app);
};

// Draws the spawn-zone preview rectangle when the admin's spawn window is
// open and editing. Reads from the React store so live edits show without
// any extra plumbing. Cleared (zero-width path) when no draft is active.
const spawnOverlaySystem = ({ overlays }: Context) => {
  const draft = useGameStore.getState().spawnDraft;
  const g = overlays.spawn;
  g.clear();
  if (!draft) return;
  g.rect(draft.x, draft.y, draft.w, draft.h).stroke({
    width: 2,
    color: 0x00ff88,
    alpha: 0.9,
  });
  // Pixi Graphics.fill is a paint method, not Array.fill.
  // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type
  g.fill({ color: 0x00ff88, alpha: 0.15 });
};

const update = (context: Context) => {
  timeSystem(context);
  inputSystem(context);
  predictionSystem(context);
  networkSendSystem(context);
  errorDecaySystem(context);
  interpolationSystem(context);
  cameraSystem(context);
  tileSpriteSystem(context);
  spritesSystem(context);
  metricsSystem(context);
  nameSystem(context);
  debugSystem(context);
  spawnOverlaySystem(context);
  editorSystem(context);
};

const loadAssets = async () => {
  // Fetch atlas info first so we can use the versioned URL the server hands
  // back. The version busts the browser cache when atlas.png changes.
  const atlasInfo = (await (await fetch("/api/atlas")).json()) as {
    width: number;
    height: number;
    url: string;
    typeIdToAtlasSrc: Record<number, [number, number]>;
  };

  const atlas = await Assets.load<TextureSource>(atlasInfo.url);
  atlas.source.scaleMode = "nearest";
  const player = await Assets.load<Texture>("/assets/sprites/player.png");
  player.source.scaleMode = "nearest";

  const catalog = (await (
    await fetch("/api/catalog")
  ).json()) as CatalogEntry[];
  const tiles: Record<number, Texture> = {};
  for (const entry of catalog) {
    tiles[entry.id] = new Texture({
      source: atlas,
      frame: new Rectangle(entry.src_x, entry.src_y, TILE_SIZE, TILE_SIZE),
    });
  }

  return { atlas, player, tiles, catalog };
};

/**
 * Boot the game. Returns a cleanup function that fully tears down Pixi,
 * the WebSocket, the ticker, and any global event listeners. Safe to call
 * multiple times (each invocation is fully independent).
 */
export const startGame = (parent: HTMLElement, user: Me): (() => void) => {
  const world = makeWorld();

  const app = new Application();
  const lifetime = new AbortController();
  let isRunning = true;
  let mountedContext: Context | null = null;
  const teardownCallbacks: Array<() => void> = [];

  useGameStore.getState().setUser(user);
  teardownCallbacks.push(() => {
    useGameStore.getState().setUser(null);
    useGameStore.getState().setEditor(null);
  });

  void (async () => {
    await app.init({
      background: "#87CEEB",
      resizeTo: window,
      roundPixels: true,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    if (!isRunning) {
      // unmounted before init completed
      app.destroy(true);
      return;
    }

    parent.appendChild(app.canvas);
    teardownCallbacks.push(() => {
      if (app.canvas.parentElement === parent) {
        parent.removeChild(app.canvas);
      }
    });

    const assets = await loadAssets();
    if (!isRunning) {
      // Cleanup fired during loadAssets. The canvas teardown is already
      // queued; let the outer cleanup loop drain it. Don't continue
      // building things the cleanup can't see.
      return;
    }

    const mainContainer = new Container();
    const tilesContainer = new Container();
    const entitiesContainer = new Container();
    const debugContainer = new Container();

    app.stage.addChild(mainContainer);
    mainContainer.addChild(tilesContainer);
    mainContainer.addChild(entitiesContainer);
    mainContainer.addChild(debugContainer);

    // Persistent overlays. These live in the world-space debug container so
    // they pan/zoom with the camera. Drawn (and cleared) by their owning
    // systems each tick.
    const spawnOverlay = new Graphics();
    debugContainer.addChild(spawnOverlay);

    // Zones overlay. Must be parented to a world-space container (under the
    // camera-translated mainContainer) so the painted cells line up with
    // tile sprites at every zoom level.
    const zoneLayer = initZonesGame(mainContainer);

    // Perimeter outline overlay for non-admin paint mode. Parented to
    // mainContainer (world-space) so the yellow outline lines up with tile
    // sprites under camera pan/zoom. Hidden by default; toggled on when the
    // user enters tile-paint mode and back off when they leave (or lose
    // their zone membership).
    const perimeter = initPerimeter(mainContainer);

    const context: Context = {
      world,
      app,
      containers: {
        main: mainContainer,
        tiles: tilesContainer,
        entities: entitiesContainer,
        debug: debugContainer,
      },
      overlays: {
        spawn: spawnOverlay,
      },
      assets,
      input: { keys: {}, prevInteract: false },
      me: {
        eid: null,
        serverEid: null,
      },
      network: {
        signal: lifetime.signal,
        timers: new Set(),
        lastSendTime: 0,
        socket: null,
        inputSeq: 0,
        lastSentSeq: -1,
        pendingInputs: [],
        predictionError: { x: 0, y: 0 },
        idMap: new Map(),
        bytesSent: 0,
        bytesReceived: 0,
        lagMs: 0,
        jitterMs: 0,
        onCatalogUpdated: (catalog) => {
          context.assets.catalog = catalog as typeof context.assets.catalog;
          const newTiles: typeof context.assets.tiles = {};
          for (const e of catalog) {
            newTiles[e.id] = new Texture({
              source: context.assets.atlas,
              frame: new Rectangle(e.src_x, e.src_y, TILE_SIZE, TILE_SIZE),
            });
          }
          context.assets.tiles = newTiles;
          debug("catalog updated locally: %d entries", catalog.length);
        },
      },
      camera: { x: 0, y: 0, initialized: false },
      metrics: {
        updatesHz: 0,
        updatesCount: 0,
        lastUpdateTime: 0,
        lastBytesSent: 0,
        lastBytesReceived: 0,
        bytesSentPerSec: 0,
        bytesReceivedPerSec: 0,
        serverTicksCount: 0,
        lastServerTickTime: 0,
        serverTickrate: 0,
      },
      debugMetrics: {
        updatesHz: 0,
        tickrate: 0,
        bytesSentPerSec: 0,
        bytesReceivedPerSec: 0,
        lag: 0,
        jitter: 0,
      },
      user,
      editor: null,
      zones: zoneLayer,
      perimeter,
    };

    setupPlayerObserver(context);
    setupTileObserver(context);

    const onKeyDown = (e: KeyboardEvent) => {
      context.input.keys[e.key.toLowerCase()] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      context.input.keys[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    teardownCallbacks.push(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    });

    const tickFn = () => update(context);
    app.ticker.add(tickFn);
    teardownCallbacks.push(() => app.ticker.remove(tickFn));

    setupSocket({
      world,
      network: context.network,
      me: context.me,
      onLocalPlayerReady: async () => {
        if (!isRunning) return;
        if (context.me.eid !== null) {
          const { Input } = world.components;
          addComponent(world, context.me.eid, Input);
          Input[context.me.eid] = {
            up: false,
            down: false,
            left: false,
            right: false,
            interact: false,
            interactPressed: false,
          };
        }

        // Editor is universal — every user (admin + non-admin) gets the
        // paint editor. Non-admins are gated per-zone via getCanEnterPaintMode
        // and getCanPaintCell, both wired to the store's `myZoneCells` slice.
        context.editor = initEditor(
          context.app,
          context.assets.catalog,
          context.assets.tiles,
          context.network,
          context.containers.main,
          () => context.camera,
          () => ZOOM,
          useGameStore.getState().palette,
          {
            signal: lifetime.signal,
            onTogglePaintMode: (mode) => {
              if (context.user.isAdmin) {
                // Admin: the `z` key flips between tile-paint and zone-paint;
                // the zone-fill overlay shows while zone-paint is active.
                setZonesActive(context.zones, mode === "zone");
              } else {
                // Non-admin: show the perimeter outline whenever tile-paint
                // is active; hide it on exit (also doubles for `Escape`,
                // which calls back with mode === "none").
                setPerimeterVisible(perimeter, mode === "tile");
              }
            },
            getCanEnterPaintMode: () =>
              canEnterPaintMode(
                context.user,
                useGameStore.getState().zones.myZoneCells,
              ),
            getCanPaintCell: (key: string) =>
              canPaintCell(
                context.user,
                useGameStore.getState().zones.myZoneCells,
                key,
              ),
          },
        );
        useGameStore.getState().setEditor({
          active: false,
          selectedTileId: context.editor.selectedTileId,
        });

        // Palette subscription is universal: both admins and non-admins curate
        // a palette via the Tile Picker, and the pixi editor's slot strip
        // needs to redraw on changes. zustand's subscribe runs on every store
        // change; the prev/curr comparison makes this a no-op for unrelated
        // state changes.
        let lastPalette = useGameStore.getState().palette;
        const unsubscribePalette = useGameStore.subscribe((s) => {
          if (s.palette !== lastPalette && context.editor) {
            lastPalette = s.palette;
            setEditorPalette(context.editor, s.palette, context.assets.tiles);
          }
        });
        teardownCallbacks.push(unsubscribePalette);

        // Perimeter overlay: prime from the current store state, then
        // subscribe to keep it in sync with `myZoneCells`. Auto-exits
        // non-admin paint mode when the user loses their last zone cell.
        setPerimeterCells(perimeter, useGameStore.getState().zones.myZoneCells);
        let lastMyCells = useGameStore.getState().zones.myZoneCells;
        const unsubscribeMyZones = useGameStore.subscribe((s) => {
          const next = s.zones.myZoneCells;
          if (next === lastMyCells) return;
          lastMyCells = next;
          setPerimeterCells(perimeter, next);
          // Auto-exit paint mode when a non-admin loses their last zone cell
          // mid-session (admin un-assigned them). Admins are never auto-
          // exited; their entry isn't gated on zone membership.
          if (
            !context.user.isAdmin &&
            next.size === 0 &&
            context.editor &&
            context.editor.active
          ) {
            exitPaintMode(context.editor);
            useGameStore.getState().setEditorActive(false);
            setPerimeterVisible(perimeter, false);
          }
        });
        teardownCallbacks.push(unsubscribeMyZones);

        if (context.user.isAdmin) {
          // Mirror the zones slice into the pixi overlay state. The
          // overlay is created up-front but only redraws when the
          // current data or selection changes (or when admin enters
          // zone-paint via `z`). Same prev/curr gating as the palette
          // subscription — we only care about reference changes on
          // the two fields the overlay consumes.
          let lastCellsByZone = useGameStore.getState().zones.cellsByZone;
          let lastSelectedId = useGameStore.getState().zones.selectedId;
          const unsubscribeZones = useGameStore.subscribe((s) => {
            if (
              s.zones.cellsByZone !== lastCellsByZone ||
              s.zones.selectedId !== lastSelectedId
            ) {
              lastCellsByZone = s.zones.cellsByZone;
              lastSelectedId = s.zones.selectedId;
              setZonesData(
                context.zones,
                s.zones.cellsByZone,
                s.zones.selectedId,
              );
            }
          });
          teardownCallbacks.push(unsubscribeZones);

          // Zone-paint mouse handlers. Same canvas → world-cell-center math
          // as the editor's tile-paint (see editor.ts), but writes into a
          // stroke accumulator and flushes on mouseup via Eden Treaty PUT.
          // Tile-paint is forced off whenever zones.active is true (mutual
          // exclusion is handled in editor.ts's `z` key handler), so the
          // existing editor handlers safely early-return in zone mode.
          const canvasToCellCenter = (
            e: MouseEvent,
          ): { x: number; y: number } | null => {
            const rect = context.app.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            // Bail when a DOM overlay (taskbar, window) is on top of the
            // pointer — same gate the tile-paint handlers use to avoid
            // painting through windows.
            const topmost = document.elementFromPoint(e.clientX, e.clientY);
            if (topmost !== context.app.canvas) return null;
            const worldX =
              (mouseX - context.app.screen.width / 2) / ZOOM + context.camera.x;
            const worldY =
              (mouseY - context.app.screen.height / 2) / ZOOM +
              context.camera.y;
            const halfTile = TILE_SIZE / 2;
            return {
              x: Math.floor(worldX / TILE_SIZE) * TILE_SIZE + halfTile,
              y: Math.floor(worldY / TILE_SIZE) * TILE_SIZE + halfTile,
            };
          };

          const onZoneMouseDown = (e: MouseEvent) => {
            const zones = context.zones;
            if (!zones.active) return;
            if (zones.selectedZoneId === null) return;
            const cell = canvasToCellCenter(e);
            if (!cell) return;
            e.preventDefault();
            const button = e.button === 2 ? "right" : "left";
            beginZoneStroke(zones, button);
            extendZoneStroke(zones, cell.x, cell.y);
          };

          const onZoneMouseMove = (e: MouseEvent) => {
            const zones = context.zones;
            if (!zones.active || !zones.isDragging) return;
            const cell = canvasToCellCenter(e);
            if (!cell) return;
            extendZoneStroke(zones, cell.x, cell.y);
          };

          // mouseup on window (not canvas) so a drag that ends off-canvas
          // still flushes the stroke. Matches the tile-paint convention in
          // editor.ts.
          const onZoneMouseUp = () => {
            const zones = context.zones;
            if (!zones.active || !zones.isDragging) return;
            if (zones.selectedZoneId !== null) {
              endZoneStroke(zones, zones.selectedZoneId).catch(
                (err: unknown) => {
                  console.error("endZoneStroke failed", err);
                },
              );
            } else {
              // Lost the selection mid-drag — drop the pending sets so
              // they don't leak into the next stroke.
              zones.isDragging = false;
              zones.dragButton = null;
              zones.pendingAdd.clear();
              zones.pendingRemove.clear();
            }
          };

          // Right-click in zone-paint mode is the "remove" gesture — block
          // the browser's context menu so it doesn't pop on every cell.
          const onZoneContextMenu = (e: MouseEvent) => {
            if (context.zones.active) e.preventDefault();
          };

          context.app.canvas.addEventListener("mousedown", onZoneMouseDown);
          context.app.canvas.addEventListener("mousemove", onZoneMouseMove);
          window.addEventListener("mouseup", onZoneMouseUp);
          context.app.canvas.addEventListener("contextmenu", onZoneContextMenu);
          teardownCallbacks.push(() => {
            context.app.canvas.removeEventListener(
              "mousedown",
              onZoneMouseDown,
            );
            context.app.canvas.removeEventListener(
              "mousemove",
              onZoneMouseMove,
            );
            window.removeEventListener("mouseup", onZoneMouseUp);
            context.app.canvas.removeEventListener(
              "contextmenu",
              onZoneContextMenu,
            );
          });
        }
      },
      onSnapshotReceived: () => {
        debug("snapshot received");
        // Tile sprites are created/destroyed by setupTileObserver — onAdd(Tile)
        // fires for both the initial snapshot and live OBSERVER deltas.
      },
      onSocketClose: () => debug("socket closed"),
      context,
    });
    teardownCallbacks.push(() => {
      if (context.network.socket) {
        context.network.socket.close();
      }
    });

    // expose for debugging from the devtools console
    (window as { context?: Context }).context = context;
    mountedContext = context;
  })();

  return () => {
    isRunning = false;
    lifetime.abort();
    if ((window as { context?: Context }).context === mountedContext)
      (window as { context?: Context }).context = undefined;
    while (teardownCallbacks.length > 0) {
      const fn = teardownCallbacks.pop();
      try {
        fn?.();
      } catch (e) {
        console.error("teardown failed", e);
      }
    }
    try {
      app.destroy(true);
    } catch {
      // already destroyed
    }
  };
};
