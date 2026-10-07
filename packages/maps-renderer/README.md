# @tea/maps-renderer

This is Tea's copy of Worldview's embeddable WebGPU viewer and renderer-free BSP format core. It reads Quake BSP29, sanitized BSP2, GoldSrc BSP30, and Quake II BSP38 maps. The public entry points are `@tea/maps-renderer`, `/core`, `/element`, `/runtime`, `/walkability`, and `/standalone`. The [viewer API guide](VIEWER_API.md) covers canvas setup and map assets. `src/core/` must stay free of DOM and WebGPU imports. This package never imports Tea apps.

From the repo root, run `npm ci`, then `npm run check --workspace @tea/maps-renderer`. The check typechecks, runs the renderer and format tests in `__tests__/`, and builds the importable bundles. `@tea/maps` is its first consumer.

This copy is private while Tea's Maps app bakes. The [MIT license](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md) stay with the adapted source. No game assets are included. The original Worldview package and repository continue separately during the migration.
