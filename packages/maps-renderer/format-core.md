# Format core

The `@jackharrhy/tea-maps-renderer/core` entrypoint exposes the binary-format work without loading the
browser viewer or renderer. It is intended for asset indexers, diagnostics, converters, and other
tools that need the same interpretation as Maps.

## Identify a container

`identifyBsp()` reads only the format prefix. It recognizes BSP29, sanitized BSP2, BSP30, and
IBSP/QBSP version 38:

```ts
import { identifyBsp, identifyWad } from "@jackharrhy/tea-maps-renderer/core";

const bsp = identifyBsp(bytes); // { format: 'goldsrc-bsp30', version: 30 } or null
const wad = identifyWad(bytes); // { version: 2 }, { version: 3 }, or null
```

Identification does not validate directories, lumps, or geometry. A short, unknown, or unsupported
prefix returns `null`. Use `parseBsp()` or `parseWad()` when malformed contents must be rejected.

## Read embedded BSP textures

`parseBspTextures()` validates the Quake-family BSP directory and texture lump without building
geometry, collision, visibility, lightmaps, or render batches:

```ts
import {
  decodeMipTexture,
  parseBspTextures,
} from "@jackharrhy/tea-maps-renderer/core";

const result = parseBspTextures(bytes);
for (const texture of result.textures) {
  console.log(texture.sourceIndex, texture.name, texture.width, texture.height);
  const decoded = decodeMipTexture(texture.data, quakePalette);
}
```

The `sourceIndex` is the original BSP texture-table index. Quake II BSP38 has no embedded MIPTEX
records, so it returns an empty texture list. Fatal table and range errors still throw. A malformed
individual record is omitted and reported through the same typed `BspWarning` used by `parseBsp()`.
GoldSrc records carry their embedded palette; Quake and BSP2 decoding still needs a caller-supplied
768-byte palette. `createQuakePalette()` from the core entrypoint returns an independent copy of
the bundled standard Quake table for this low-level API. The viewer and editor select it by default.

## Inspect WAD files

`parseWad()` keeps every structurally valid directory entry in source order. Each `WadLump` records
its `sourceIndex`, type, compression, declared size, on-disk size, and raw bytes. A valid MIPTEX
entry also has `mipTexture`, which uses the same record shape as focused BSP extraction.

Compressed entries, inconsistent per-entry sizes, and unusable MIPTEX data produce typed
`WadWarning` values instead of hiding the rest of the archive. Invalid headers, directories, source
ranges, and integer bounds remain fatal. `findMipTexture()` returns only a validated, decodable
MIPTEX record.

Maps uses Quake's external palette for WAD2 and the embedded palette for WAD3. Index 255 is
transparent only for alpha-test texture names beginning with `{`; there is no color-key fallback.

## Plan external assets

`planWorldAssets()` is the viewer's canonical, fetch-free asset manifest:

```ts
import { parseBsp, planWorldAssets } from "@jackharrhy/tea-maps-renderer/core";

const world = parseBsp(bytes);
const assets = planWorldAssets(world, { includeViewerDefaults: false });
```

The plan contains palette candidates, declared WADs, referenced Quake II materials, skybox faces,
GoldSrc sprites, and map audio. Candidate paths are normalized game-root paths in viewer lookup
order. Quake II image replacements and WALs are separate lists because a replacement image may
supply pixels while a companion WAL supplies authored dimensions. Texture plans include animated
texinfo chains and the rerelease `+` to `_` filename alternative.

`normalizeGameAssetPath()` exposes the same lowercase, relative-path boundary for callers that
accept their own logical paths. Empty segments, absolute paths, and `.` or `..` traversal are
rejected. `planWorldAssets()` applies it before returning any candidate.

By default the plan also lists Maps's GoldSrc player sounds with
`origin: 'viewer-default'`. Pass `includeViewerDefaults: false` when indexing only assets authored
by the map. Missing-asset policy and storage remain the caller's responsibility; the plan does not
label candidates as mandatory.

The viewer consumes this same plan. Archive extraction, path containment, authorization, storage,
network lookup, and image encoding are intentionally outside the format core.
