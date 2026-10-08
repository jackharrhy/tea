# Tea Marky contributor guidance

Marky is a Remix 3 stable Node app. Read this workspace README and the root Remix skill before changing routing, components, or middleware. `server.ts` starts the HTTP router and the `ws` collaboration endpoint. The app owns its filesystem store, Yjs protocol, Discord authentication, and Git persistence; keep those modules here until another consumer needs them.

Use `npm run check --workspace @tea/marky` for typecheck and server tests. Tests live in `__tests__/`. Keep production content and sessions out of the source tree. In production, mount `/app/data` persistently and set `MARKY_CONTENT_DIR` and `MARKY_SESSION_DIR` within it. The Node image uses Debian Bookworm.

The production endpoint is `md.jackharrhy.dev`, guarded by Discord guild membership. Host routing, encrypted credentials, and volume operations belong to the infra repository. Do not log credentials or copy them into Tea.
