# @harrhy/ui

Small Remix 3 style mixins for controls shared by independent Harrhy apps. Apps call `createUiTheme` with their colors and optional control radius, then choose where to apply the mixins. The package does not choose a product font, layout, icon set, or visual theme. It contains styles only; form behavior and validation stay with the app and native HTML.

Import `createUiTheme` and `uiControlStyles` on an app root. Apply `uiActionStyles` together with `uiPrimaryActionStyles` or `uiSecondaryActionStyles` to native action links, buttons, or disclosure summaries. The shared base gives links and buttons the same target size and alignment; the app keeps its own layout and copy. The first consumer is Ref; its neutral board palette remains in `apps/ref/app/styles.ts`. Radio, Pool, and Worldview can supply their own palettes and control shapes when they adopt these mixins.

Use native controls for straightforward forms. Add `@remix-run/ui` headless primitives in an app only when a control needs managed keyboard, focus, or dismissal behavior; it is currently versioned independently from `remix`. The package's variables are a contract for colors and control shape, not a universal aesthetic. Ref's quiet board, Radio's compact desktop, Pool's wood hall, and Worldview's map tools can use distinct values.

Run `npm run check --workspace @harrhy/ui` from the repository root. The package has no browser entry or runtime state.
