# Shared UI direction

`@harrhy/ui` begins with control styles used by Ref. It gives apps a common baseline for inputs, buttons, disabled states, keyboard focus, and a primary action. The app provides the palette and radius through CSS variables; typography, layout, surfaces, icons, and product-specific interactions remain with the app.

Ref is the first proving ground because its signed-out page, board list, and board toolbar use simple native controls. Its freeform canvas, gestures, inspector, and image cards remain Ref code. Before moving another app to the package, compare its rendered controls and keyboard behavior to Ref and choose its own theme variables. Avoid replacing Radio's compact desktop, Pool's hall, or Worldview's editor with Ref's appearance.

Use native HTML for links, forms, buttons, and simple disclosure. For complex controls, Remix UI offers headless keyboard, focus, and dismissal behavior through the separate, currently unstable `@remix-run/ui` package. Adopt a primitive where the app needs that behavior and keep its visual treatment local. Do not make `@harrhy/ui` a wrapper around every Remix UI export.

Next candidates are Lists' admin controls and the CMS operator dashboard, where repeated forms and actions can benefit from the same control contract. Review each app in a browser before adoption and keep its own visual identity. Extract additional shared pieces only after a second real consumer needs the same markup or behavior.
