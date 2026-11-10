# @tea/pool-simulation

Internal Tea package imported from 8ballworld revision `ad1dc4446e1ab8e7b32111c95f6a3479ab8e532c`.

Shared hall geometry, Navcat pathfinding, and bitECS movement used by the authoritative room server and browser prediction.

## Entry points

- `.`: `./src/index.ts`
- `./geometry`: `./src/geometry.ts`

## Setup and checks

From the Tea root, run `npm ci` then `npm run check --workspace @tea/pool-simulation`. The check typechecks the source and runs its physics/protocol tests.

## Boundary

This package owns reusable game logic. Browser presentation, authentication, WebSocket admission, storage, and deployment configuration belong to the pool app.
