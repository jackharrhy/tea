# Artbin core

Shared file detection, archive parsing, scanning settings, and resumable upload code used by the Artbin web app and CLI. Exports are declared in `package.json` and implemented in `src/`. This package does not import an app.

From the Tea root, run `npm ci` and `npm run check --workspace @tea/artbin-core`. Tests live in `__tests__/`. Keep web routes, database behavior, and presentation in `apps/artbin`.
