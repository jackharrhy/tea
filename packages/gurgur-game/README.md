# @harrhy/gurgur-game

Gurgur's shared player/grab controllers, simulation, entity schema and Valve 220 world compiler. The Bun authority and browser prediction use the same controller code; saved authored IDs and world revisions must remain stable.

Install at the Tea root with `npm ci`; Bun 1.4.4 is required for tests. Run `npm run check --workspace @harrhy/gurgur-game` for types and focused tests. The entry is `src/index.ts`; `@harrhy/gurgur-engine` supplies physics and protocol types. Browser presentation, transport and persistence belong to the app, not this package.
