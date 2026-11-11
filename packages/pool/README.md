# @harrhy/pool

Internal Tea package imported from 8ballworld revision `ad1dc4446e1ab8e7b32111c95f6a3479ab8e532c`.

Shared 8-ball rules, rack state, Box3D physics, physical table geometry, and shot recording schemas. Both the authoritative room server and browser prediction use this package. Physics worlds must be disposed after use.

## Entry points

- `.`: `./src/index.ts`
- `./engine`: `./src/engine.ts`
- `./table`: `./src/physical-table.ts`
- `./recording`: `./src/recording.ts`

## Setup and checks

From the Tea root, run `npm ci` then `npm run check --workspace @harrhy/pool`. The check typechecks the source and runs its physics/protocol tests.

## Boundary

This package owns reusable game logic. Browser presentation, authentication, WebSocket admission, storage, and deployment configuration belong to the pool app.
