# Third-party notices

## jsdiff

The editor uses [jsdiff](https://github.com/kpdecker/jsdiff) to display local and hosted map source differences. It is distributed under the BSD 3-Clause License. Copyright © 2009–2015 Kevin Decker. The license text is included with the installed `diff` package in `node_modules/diff/LICENSE` and in its published distribution.

Worldview contains code adapted from the IdTech2/GoldSrc renderer in
[noclip.website](https://github.com/magcius/noclip.website).

---

MIT License

Copyright (c) 2018 Jasper St. Pierre

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Standard Quake palette

`packages/worldview/src/core/quake-palette.ts` contains the standard Quake 256-color RGB lookup
table from id Software's `gfx/palette.lmp`. The 768 bytes were extracted from the local Quake
installation's `id1/PAK0.PAK` and have SHA-256
`6b20b5bc4ea965ef1852b05670d043ca16148a0ecad4e63028121c8aebc268fe`.

This table is included under the project's explicitly approved compatibility-data exception so
Quake authoring, builds, and viewing use the engine's expected colors without an asset upload.
Its data provenance is separate from the MIT implementation; no GPL engine implementation was
copied. The exception is limited to this palette and does not cover game artwork or archives.

## LibreQuake test map

`packages/worldview-editor/test/fixtures/librequake-b_batt0.map` is a normalized-LF copy of
LibreQuake's `lq1/maps/src/brushmodels/b_batt0.map`, pinned from commit
`e53f8313ab2c396dbc9ed911f5489629234b68e1`. The map credits Mr.M and Nolcoz in its
`worldspawn`. It is used only as source-format compatibility test data.

Copyright © 2019-2023 Contributors to the LibreQuake project. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted
provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice, this list of conditions
  and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice, this list of
  conditions and the following disclaimer in the documentation and/or other materials provided
  with the distribution.
- Neither the name of the LibreQuake project nor the names of its contributors may be used to
  endorse or promote products derived from this software without specific prior written
  permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Hosted URL dependencies

The Worldview service uses the following MIT-licensed packages for compact random identifiers and
Unicode-aware decorative URL slugs. Their package distributions retain their license texts.

- [`nanoid`](https://github.com/ai/nanoid) 6.0.1, copyright Andrey Sitnik and contributors.
- [`@sindresorhus/slugify`](https://github.com/sindresorhus/slugify) 3.0.0, copyright Sindre Sorhus.
- [`@sindresorhus/transliterate`](https://github.com/sindresorhus/transliterate) 2.3.1,
  copyright Sindre Sorhus.
- [`escape-string-regexp`](https://github.com/sindresorhus/escape-string-regexp) 5.0.0,
  copyright Sindre Sorhus.

## Runtime schema validation

Worldview uses [`zod`](https://github.com/colinhacks/zod) 4.4.3 for declarative runtime schemas at
browser, persistence, package, and service trust boundaries. Zod is distributed under the MIT
License; its package distribution retains the license text. Copyright Colin McDonnell and
contributors.

## Editor interface dependencies

Worldview's editor uses the following MIT-licensed packages for its shared icon language and
virtualized material catalog. Their package distributions retain their license texts.

- [`@phosphor-icons/web`](https://github.com/phosphor-icons/web) 2.1.2, copyright Phosphor Icons.
- [`@tanstack/react-virtual`](https://github.com/TanStack/virtual) 3.14.10 and its
  `@tanstack/virtual-core` dependency, copyright Tanner Linsley and contributors.

## Browser persistence dependencies

Worldview's editor uses [`idb`](https://github.com/jakearchibald/idb) 8.0.3 for its typed IndexedDB
connection, transactions, and upgrades. `idb` is distributed under the ISC License. Persistence
tests use [`fake-indexeddb`](https://github.com/dumbmatter/fakeIndexedDB) 6.2.5, distributed under
the Apache License 2.0. Their package distributions retain their license texts.

## Architecture tooling

Worldview uses [`oxc-parser`](https://github.com/oxc-project/oxc) 0.143.0 to read TypeScript and
TSX module edges for repository architecture checks. Oxc is distributed under the MIT License;
its package distribution retains the license text. Copyright VoidZero Inc., Boshen, and Oxc
contributors.

## TrenchBroom interface research

TrenchBroom's GPL-licensed `MapWindow.cpp`, `Inspector.cpp`, and toolbar graphics were consulted
as behavior and visual references for toolbar grouping and restrained icon color. No TrenchBroom
implementation code or artwork is included. Worldview uses original geometry SVGs authored for this MIT project alongside the MIT-licensed Phosphor
icons listed above; its toolbar composition and theme rules are independently implemented.

`AssembleBrushToolController3D.cpp` was also consulted for hull construction behavior: yellow
vertex handles and edges, and a translucent planar face under Shift. Worldview's hull geometry
helpers, GPU billboards, shaders, and input feedback are original implementations; no GPL code
or assets were copied.

`ExtrudeTool.cpp` and `ExtrudeToolController.cpp` informed selected-face targeting, nearest
silhouette fallback, full selected-face extrusion previews, and on-top drag outlines. Its outward split selection and moving-cap behavior also informed the multi-face split workflow. Worldview implements these behaviors independently.

TrenchBroom's `Face.fragsh` and `GridCommon.fragsh` informed the passive surface-grid behavior
(world alignment, antialiasing, distance suppression, and texture-aware contrast). Worldview's
`surface-grid-shader.ts` is an original TypeGPU implementation; no GPL shader code is included.

TrenchBroom's `Edge.vertsh`, `Edge.fragsh`, and OpenGL startup configuration were inspected for
line-rendering behavior and 4× multisampling. Worldview's shared pixel-space stroke geometry and
analytic coverage in `gpu-line-shaders.ts` are independently authored TypeGPU code.

Editor minification research also consulted TrenchBroom's `lib/TbGlLib/src/Texture.cpp` and
`lib/TbUiLib/src/ViewPreferencePane.cpp` for mipmapped filtering and the single-level masked-texture
exception. The editor's mip generation, procedural perspective grid, and bounded stroke projection
are original MIT implementations; no TrenchBroom source was copied.

The V2 editable icon working sheet at `apps/editor/public/design/worldview-icons-v2.svg` includes
MIT-licensed Phosphor Icons 2.1.2 vector paths from the installed package's Regular selection data,
alongside original Worldview geometry icons. The complete Phosphor MIT notice is embedded in the
SVG metadata. `scripts/export-editor-icons.mjs` exports these paths without embedding a font.

## Engine lighting compatibility research

Xash3D FWGS `engine/common/imagelib/img_wad.c` and `ref/gl/gl_rsurf.c` at commit
[`1de8289f2980aa34c70760ae0ebfb2e00ddb0f9e`](https://github.com/FWGS/xash3d-fwgs/tree/1de8289f2980aa34c70760ae0ebfb2e00ddb0f9e)
were consulted to confirm Quake fullbright palette indices and dark sampleless surfaces in lit
maps. id Software's Quake II `ref_gl/gl_light.c` was consulted to preserve that format's different
sampleless-surface behavior. These GPL sources are compatibility references only; no engine
implementation code was copied. Worldview's fixes and synthetic tests are
independently authored.

[QSS-M 1.6.5](https://github.com/timbergeron/QSS-M/releases/tag/1.6.5), built from commit
[`3de3009ec672492ea06088b2ccca98c500503faf`](https://github.com/timbergeron/QSS-M/tree/3de3009ec672492ea06088b2ccca98c500503faf),
was run locally as a Quake rendering oracle. Its `Quake/gl_texmgr.c`, `Quake/r_world.c`, and
`Quake/r_brush.c` were inspected for fullbright palette separation, lightstyle scaling, and neutral
gamma/contrast behavior. Xash3D FWGS's `engine/client/gamma.c` at the commit above was also consulted
to distinguish GoldSrc texture/light gamma from Quake palette behavior. These are GPL compatibility
references only. The decoded fullbright metadata, TypeGPU composition, and format lighting rules
are original MIT implementations; no engine source was copied into this repository. The separately
approved standard palette is documented above.

The optional [native capture tooling](./docs/engine-capture.md) downloads that QSS-M release and
builds that Xash revision in a local Docker image. It also builds
[CS16Client at `57607ab038be0fc49b67c7a4a741ef8a44031577`](https://github.com/Velaron/cs16-client/tree/57607ab038be0fc49b67c7a4a741ef8a44031577),
which is GPL-2.0-or-later with its stated Valve linking exception. Xash's documented
[CS client recommendation](https://github.com/FWGS/xash3d-fwgs/blob/1de8289f2980aa34c70760ae0ebfb2e00ddb0f9e/Documentation/supported-mod-list.md)
informs this setup. Native console/entity command behavior and CS16Client view offsets were
consulted to position and verify cameras. Dockerfiles and automation are independently authored;
engine/client source and binaries remain outside the MIT package, with their upstream license
files in the image. Users supply their own commercial CS and Quake data.

## fflate

The editor uses [fflate](https://github.com/101arrowz/fflate) to package build exports as ZIP files.

MIT License

Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
