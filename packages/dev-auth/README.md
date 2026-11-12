# @harrhy/dev-auth

A disposable local OIDC issuer for Harrhy apps. It implements the same authorization-code, PKCE S256, signed ID token, userinfo, and introspection protocol that consumers use with Jack Auth. It does not contain real accounts or grants and must never be used for production data. The server binds to `127.0.0.1` by default and keeps codes, keys, and tokens in memory. Restarting it invalidates them.

`apps.json` is an explicit allowlist of development browser clients, callback URLs, project IDs, and local roles. Add an entry when another app adopts local OAuth development; do not reuse Ref's client or grant every app a role by default. `HARRHY_DEV_AUTH_CONFIG` selects another local JSON file. `HARRHY_DEV_AUTH_PORT`, `HARRHY_DEV_AUTH_ORIGIN`, `HARRHY_DEV_AUTH_CALLBACK` (only when one app is configured), and `HARRHY_DEV_AUTH_BIND` customize the process. Use HTTPS at the public edge when previewing over a Tailnet; the Node process can stay bound to loopback behind that edge.

Ref starts this process through `npm run ref:dev`. The identity issuer is a development fixture; the Ref consumer has one OAuth implementation for local and production use. Check this package with `npm run check --workspace @harrhy/dev-auth` and exercise its full browser flow with Ref's smoke.

For local archive CLI checks, `node packages/dev-auth/token.mjs /private/new-token-file` runs an independent code and PKCE exchange, then writes only the access token to a new mode 0600 file. Point `REF_ACCESS_TOKEN_FILE` at it. Delete the file after use.
