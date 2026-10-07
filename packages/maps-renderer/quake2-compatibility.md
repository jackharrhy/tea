# Quake II compatibility

This document records the delivered Quake II boundary and its compatibility evidence. Unfinished
format work is tracked only in [the backlog](./cleanup-plan.md#f1-quake-ii-viewer-depth).

## Delivered source boundary

- `quake2` is a distinct game profile using classic face syntax, WAL material identity, and DEF or
  ENT definitions. It reuses the `quake-map` document codec because the source grammar does not
  justify a nominal container format.
- Face `contents flags value` integers remain lossless semantic data. The profile supplies names for
  the standard Quake II bits while unknown bits remain numeric and survive editing for compiler and
  mod compatibility.
- Project manifests accept ordered game-directory roots independently from WAD archives. Later
  roots override the same logical game path from earlier roots.
- Project manifests accept the profile's existing DEF and ENT definition formats and reject
  incompatible formats at the manifest boundary. Definitions flow through the shared catalog and
  entity inspector rather than a Quake II-specific parser or UI path.
- The texture inspector exposes profile-owned contents/surface flags and face values. Multi-face
  edits are atomic and undoable, mixed values are explicit, and named-bit edits preserve unknown
  compiler or mod bits.
- The safe helper protocol accepts Quake II compile and launch capabilities. The local helper
  advertises Quake II only when an external `q2tool` executable is explicitly configured, and the
  editor selects compile/launch profiles only after matching the active game.
- The DOM-free BSP core accepts classic `IBSP` and rerelease `QBSP` version 38. It validates the
  common 19-lump directory and reads QBSP's widened face and edge records without weakening classic
  bounds checks. Trailing BSPX `DECOUPLED_LM` records provide the rerelease maps' independent RGB
  lightmap dimensions, sample offsets, and texture-space projections. Both variants produce static
  world and brush-model geometry, entities, signed surface values, surface classifications, RGB
  lightmaps, draw batches, and bounds through the same renderer contract as BSP29/30. BSP38
  artifacts install through the editor's revision-safe compiled-preview handoff.
- The public viewer resolves case-insensitive logical game paths from explicit sources, an async
  resolver, or a game base URL. It reads the palette from `pics/colormap.pcx`, resolves WAL pixels
  and PNG/TGA/JPEG replacements, retains companion-WAL dimensions for UVs, loads six-face `env/`
  skyboxes, and implements texinfo animation chains, flowing surfaces, Quake II turbulence,
  `TRANS33`/`TRANS66`, `SKY`, `WARP`, and `NODRAW` behavior.
- Local editor projects decode the same loose assets into the source material catalog and pass the
  original logical files to revision-safe compiled preview. Browser file loading recognizes WAL,
  PCX, replacement-image, and directory-relative game paths.
- Synthetic MIT-owned tests cover exact no-op save, normalized serialize/reparse, named flag
  decoding, unknown-bit retention, and Quake II project-manifest round trips.

## Source corpus evidence

The ignored local smoke corpus is
[`dfsp-spirit/spirit-quake-maps-gpl`](https://github.com/dfsp-spirit/spirit-quake-maps-gpl/tree/2884ac21efb8ef9772373a749ac513f9b2e676d0),
pinned at `2884ac2`. Its map sources are GPL-2.0 and are compatibility inputs only; they are not
copied into this MIT repository or package.

| Observation                         | Result                                        |
| ----------------------------------- | --------------------------------------------- |
| Quake II maps                       | 9                                             |
| Brushes                             | 14,662                                        |
| Faces                               | 89,565                                        |
| Faces with surface attribute values | 66,749                                        |
| Material names                      | 286                                           |
| Exact no-op saves                   | 9/9                                           |
| Normalized serialize/reparse        | 9/9                                           |
| Parser/save failures                | 0                                             |
| Strictly invalid derived brushes    | 7 retained and diagnosed, not silently healed |

All nine files use classic axial syntax. The corpus includes standard and compiler-extension flag
bits, mixed liquid/clip/detail contents, nonzero light values, comments, and large authored maps.
The raw numeric values are the authority when a profile catalog does not recognize an extension.

The standard names and numeric compatibility were checked against id Software's GPL Quake II
`q_shared.h`. That source is a behavior oracle only; no GPL implementation is adapted here.

The same boundary was smoke-tested against id Software's GPL Quake II game sources at commit
`372afde46e7defc9dd2d719a1732b8ace1fa096e`: all 148 `QUAKED` declarations across 30 source files
parsed with zero diagnostics. Those sources remain an external compatibility oracle and are not
copied into this repository. A small MIT-owned synthetic project fixture keeps the Quake II
definition-loading lifecycle under CI.

The local safe-helper path was smoke-tested with q2tools-220 commit
`07d8d893cb04ba5f39a63d7382e8d9979b3f38da` and the GPL Spirit corpus map `spirit2dm1.map` at the
corpus commit above. A preview request returned HTTP 200, preserved source revision 42, and produced
a 720,216-byte `IBSP` version 38 artifact with non-truncated logs. Missing retail textures were
reported as warnings and no commercial data was supplied. The preview plan deliberately runs BSP
and fast VIS only; final builds add RAD and therefore require the operator's configured game data.

That artifact also passed the DOM-free parser with 27,322 render vertices, 15,906 triangles, 5,708
faces, 87 draw batches, 161 texinfo-derived materials, and three models. A separate MIT-owned sealed
room was compiled with the same real helper and visibly rendered in the editor at revision 0 using
the missing-WAL checkerboard. No GPL map or compiler output is committed.

## Compiled asset corpus evidence

The ignored Steam corpus tooling scans owned game installs without committing their contents. It
preserves BSP provenance and materializes only bounded render assets: GoldSrc WADs and `gfx/env/`
skybox faces, Quake `gfx/palette.lmp`, plus Quake II WAL and PNG/TGA/JPEG files under `textures/`,
`pics/colormap.pcx`, and PNG/TGA/JPEG skybox faces under `env/`. Loose files are applied first and
archives are processed in stable path order, so later patch archives override earlier assets
deterministically.

On 2026-09-01, the Thirty Flights of Loving/Gravity Bone install contributed five BSP38 maps and
379 filtered game assets. All five maps reached `Ready` in headless Chromium with SwiftShader,
rendered their real replacement art and RGB lightmaps, and submitted frames without browser or
WebGPU errors. Four maps resolved every referenced texture; `hof1.bsp` retains one genuine bogus
`texturesa` reference and reports it through the normal missing-texture warning. The corpus contains
sky, warp, flow, `TRANS33`, `TRANS66`, and `NODRAW` surfaces, so this is broader evidence than the
synthetic shader smoke alone. The test remains optional when the ignored commercial corpus is not
installed.

The corpus extractor, discovery index, parser checks, and optional browser test are committed. The
five BSPs, PK3s, palette, and image files remain ignored local data.

The expanded owned-game sweep on 2026-09-01 parsed all 2,242 discovered BSPs: 1,461 GoldSrc BSP30,
379 Quake BSP29, 66 sanitized BSP2, and 336 Quake II BSP38. The rerelease group has twelve `QBSP`
and sixteen `IBSP` maps; all 28 load BSPX decoupled lightmaps. The QBSP and BSPX layouts were
independently implemented from format behavior described by q2tools-220 and verified against the
real files; the GPL tool remains a research oracle and no implementation code enters this package.
The same pass reported and safely reordered 122 compiler-emitted model bounds with one or more
reversed axes; the warning retains the model index and named axes, while non-finite geometry and
texture-coordinate overflow remain hard failures.
The representative `mgu1m1.bsp` produces 107,408 triangles, 48,296 lit faces, one atlas page, and
7,444,854 RGB sample bytes. A focused headless-WebGPU smoke renders it with its real game-root WALs
alongside Ricochet, Blue Shift, and the existing five-map BSP38 smoke.

## Current limit

BSP38 visibility and collision, direct browser PAK/PK3 mounting, Quake II alias models, sprites, and
game audio are not supported. The current resolver still lets an embedding application or service
mount archives without coupling archive policy to the BSP core. Compiler choice and executable
paths remain machine-local, and portable projects name only logical build profiles and game roots.
