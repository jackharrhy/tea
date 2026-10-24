# @jackharrhy/tea-maps-renderer

Tea provides an embeddable WebGPU viewer and renderer-free BSP format core. It reads Quake BSP29, sanitized BSP2, GoldSrc BSP30, and Quake II BSP38 maps. The public entry points are `@jackharrhy/tea-maps-renderer`, `/core`, `/element`, `/runtime`, `/walkability`, and `/standalone`. The [viewer API guide](VIEWER_API.md) covers canvas setup and map assets. `src/core/` must stay free of DOM and WebGPU imports. This package never imports Tea apps.

From the repo root, run `npm ci`, then `npm run check --workspace @jackharrhy/tea-maps-renderer`. The check typechecks, runs the renderer and format tests in `__tests__/`, and builds the importable bundles. `@tea/maps` is its first consumer. Run `npm run test:embed --workspace @tea/maps` for an independent browser host check of the packaged standalone element, pointer lock, and sound.

The [MIT license](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md) stay with the adapted source. No game assets are included. Tea Maps is the production host for this package.
