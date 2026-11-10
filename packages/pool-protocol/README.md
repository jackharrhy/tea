# @tea/pool-protocol

Internal Tea package imported from 8ballworld revision `ad1dc4446e1ab8e7b32111c95f6a3479ab8e532c`.

Versioned hall WebSocket messages and validation shared by the pool browser and authoritative room server.

## Entry points

- `.`: `./src/index.ts`
- `./admin`: `./src/admin.ts`
- `./pool-trace`: `./src/pool-trace.ts`

## Setup and checks

From the Tea root, run `npm ci` then `npm run check --workspace @tea/pool-protocol`. The check typechecks the source and runs its physics/protocol tests.

## Boundary

This package owns reusable game logic. Browser presentation, authentication, WebSocket admission, storage, and deployment configuration belong to the pool app.
