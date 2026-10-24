# Viewer API

`@jackharrhy/tea-maps-renderer` is the embeddable viewer package. It renders Quake BSP29, sanitized BSP2,
GoldSrc BSP30, and Quake II IBSP/QBSP version 38 through WebGPU and TypeGPU.

```sh
npm install @jackharrhy/tea-maps-renderer
```

## Create a viewer

Pass a canvas and a `WorldSource` to `createMapsViewer()`:

```ts
import { createMapsViewer } from "@jackharrhy/tea-maps-renderer";

const viewer = await createMapsViewer({
  canvas: document.querySelector("canvas")!,
  source: {
    gameBaseUrl: "/games/valve/",
    bsp: "maps/c1a0.bsp",
  },
});
```

Walking is the default control mode. Press `V` to switch between walking and flying. Map audio
starts only after a canvas interaction or an explicit `enableAudio()` call. Canvas interactions
also resume suspended audio without reloading the map. The `<tea-map-view>` element enables this
behavior by default; `audio="false"` disables automatic activation on interaction. A click while
map assets are loading enables the audio context, and sounds start when those assets arrive.

Movement and audio settings can change at runtime:

```ts
viewer.setMovement({ mouseSensitivity: 3, mouseAcceleration: 0.04 });
viewer.setPlayerAudioVolume(1.25);

await viewer.playMusic();
viewer.setMusicVolume(0.7);
```

Movement settings include speed, ground and air acceleration, friction, stop speed, mouse
sensitivity, mouse acceleration, and view bob. GoldSrc values are the default. Maps with
Counter-Strike entities use a 250-unit player speed cap.

## Load game assets

`gameBaseUrl` points to an extracted Quake, GoldSrc, or Quake II game or mod directory. The renderer
uses the usual game paths for BSPs, WADs, palettes, skyboxes, sprites, sounds, and Quake II
textures. Individual sources and resolvers can override that layout.

Quake BSP29/BSP2 uses the bundled standard palette when none is supplied. An explicit `palette`
source takes precedence over `gfx/palette.lmp` from game assets, which takes precedence over the
bundled palette. GoldSrc retains its per-texture palettes; Quake II still uses its own PCX palette.

Caller-supplied `wads` and `palette` sources start loading alongside the BSP. `resolveWad` runs
after parsing because the WAD names come from the map. Progress events report bytes for the current
transfer and stable item counts through `phaseProgress` when several WADs load at once:

```ts
viewer.addEventListener("progress", ({ detail }) => {
  if (detail.phase === "wad" && detail.phaseProgress) {
    const { completed, total } = detail.phaseProgress;
    console.log(`${completed}/${total} WAD files complete`);
  }
});
```

Quake II assets use normalized, lowercase paths below a game root. You can supply an extracted
directory with `gameBaseUrl`, provide a `gameAssets` table, or resolve each asset through your own
storage layer:

```ts
await createMapsViewer({
  canvas,
  source: {
    bsp: "/api/maps/bar1.bsp",
    resolveGameAsset: ({ path, kind }) => `/api/game-assets/${kind}/${path}`,
  },
});
```

The resolver receives paths such as `pics/colormap.pcx`, `textures/e1u1/wall.wal`, and
`env/dusk1up.jpg`. It returns a `BinarySource`, or `null` when the asset is absent. The package does
not mount PAK or PK3 archives itself.

Asset services can inspect formats and ask for the exact candidate paths the viewer will use
through the renderer-free `@jackharrhy/tea-maps-renderer/core` entrypoint. See the
[format core guide](./format-core.md) for `identifyBsp()`, `parseBspTextures()`, strengthened WAD
records, and `planWorldAssets()`.

## Capture a map overview

`captureOverview()` renders a top-down image without moving the live camera:

```ts
const { image, layout } = await viewer.captureOverview({
  width: 1024,
  height: 1024,
  rotation: "auto",
  lighting: "lightmapped",
  background: "transparent",
});

const url = URL.createObjectURL(image);
document.querySelector<HTMLImageElement>(".map-icon")!.src = url;
console.log(layout.zMin, layout.zMax, layout.worldUnitsPerPixel);
```

Overview captures use an orthographic camera and draw the whole map without PVS culling. Options
cover PNG or WebP output, fullbright or lightmapped rendering, rotation, sky and sprite inclusion,
and `zMin` or `zMax` clipping for ceilings and overlapping floors. The development viewer exposes
these settings under `Map > Overview`.

When a walkability graph is loaded, the default cutaway removes ceilings near sampled player
space. Use `cutaway: 'none'` for one global height slice, or `cutaway: 'walkability'` when a missing
graph should be an error.

## Generate walkability

The renderer can sample the standing-player collision hull and build a directed graph of places a
player can walk, jump to, or drop from:

```ts
import {
  generateWalkability,
  parseWalkability,
  serializeWalkability,
} from "@jackharrhy/tea-maps-renderer/walkability";

const graph = await generateWalkability(viewer.world!, {
  spacing: 32,
  allowJump: true,
});

viewer.setWalkability(graph);
viewer.setWalkabilityVisible(true);

const saved = serializeWalkability(graph);
viewer.setWalkability(parseWalkability(saved));

await viewer.loadWalkability("/maps/c1a0.tea-maps-walkability.json", {
  signal,
});
```

`loadWalkability()` accepts the same URL, `Blob`, `ArrayBuffer`, and typed-array sources as map
assets. It checks the graph fingerprint against the current BSP and cancels stale work when another
graph or map starts loading. The graph records one-way connections, blocked probes, connected
components, and local ceiling heights. It is collision data for inspection and overview cutaways,
not a gameplay navigation mesh.

The Tea viewer can generate and inspect graphs in its Walkability panel. Save a local
fixture graph as `<map>.tea-maps-walkability.json` beside its BSP to load it automatically.

## Use the web component

Register `<tea-map-view>` when your application uses the npm package:

```ts
import { defineMapsViewElement } from "@jackharrhy/tea-maps-renderer/element";

defineMapsViewElement();
```

```html
<tea-map-view game-base-url="/games/valve/" src="maps/c1a0.bsp"></tea-map-view>
```

For application-owned assets, assign one `WorldSource` before or after connecting the element. This
keeps authenticated resolvers and the rest of the map load in one operation:

```ts
import {
  MapsViewElement,
  defineMapsViewElement,
} from "@jackharrhy/tea-maps-renderer/element";

defineMapsViewElement();

const map = document.querySelector<MapsViewElement>("tea-map-view")!;
map.source = {
  bsp: "/api/maps/c1a0.bsp",
  palette: "/api/games/id1/gfx/palette.lmp",
  wads: ["/api/wads/halflife.wad"],
  resolveWad: ({ basename }) => `/api/wads/${basename}`,
};
map.walkabilitySource = "/api/maps/c1a0.tea-maps-walkability.json";
map.walkabilityVisible = true;
```

Set `source` to `null` to return to the URL attributes. `walkabilitySource` accepts any
`BinarySource`; `walkability-src` is its markup form, and `null` returns control to that attribute.
`walkabilityVisible` reflects the `walkability-visible` attribute without adding a host keybinding.

The `ready` event means the BSP is rendered and interactive. Optional walkability loads afterward
without returning the element to its blocking state and continues to emit `walkability` progress.
Changes are mirrored through `walkabilitychange`. An invalid sidecar emits `asset-warning` but
leaves the map usable. Replacing the source, replacing the sidecar, or disconnecting the element
aborts stale work.

The standalone module registers the element for pages without a build step:

```html
<script type="module" src="/vendor/tea-maps/standalone.js"></script>
<tea-map-view game-base-url="/games/id1/" src="maps/start.bsp"></tea-map-view>
```

Run `npm run test:embed --workspace @tea/maps` in this repository for browser checks, including the
packaged element's shadow-root pointer lock and gesture-activated audio. These tests use generated
maps and WAVs to measure camera movement, nonzero audio output, and recovery from suspended audio
without requiring game files or speakers.

## Runtime utilities

Scheduling and external-store helpers have a GPU-independent entrypoint. Importing it does not load
the BSP renderer:

```ts
import {
  AnimationFrameScheduler,
  SnapshotStore,
} from "@jackharrhy/tea-maps-renderer/runtime";
```

## Game data

The renderer includes the standard Quake color lookup table as a documented compatibility-data
exception. Provide your maps, texture packs, custom or Quake II palettes, skyboxes, sprites, and
sounds separately, with permission to use them.

See the [Quake II compatibility notes](./quake2-compatibility.md) for the current format boundary.
