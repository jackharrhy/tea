# @tea/maps-editor

Tea's copy of Worldview's DOM-free Valve 220 map document, convex-brush, command, and WebGPU source-rendering primitives. It is an importable package used by the Remix Maps editor; it is not a deployable app. `src/core/` owns the map model and operations, while `src/render/` owns source rendering. The host provides viewport canvases and optional DOM overlays for lasso and transform feedback. The package imports the public `@tea/maps-renderer/core` entry point and no app code.

From the repo root, run `npm ci` and `npm run check --workspace @tea/maps-editor`. The check typechecks, runs `__tests__/`, and builds the public `.`, `/core`, and `/render` entry points. Run the renderer check too when changing the renderer interface.

No game assets are included. The [MIT license](LICENSE) and [Worldview third-party notices](THIRD_PARTY_NOTICES.md) travel with this copied source. The original Worldview editor package continues independently while Tea's UI is migrated.
