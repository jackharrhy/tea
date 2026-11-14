# Rotund

Rotund is the small Remix 3 service directory at `https://rotund.org`. It keeps the original face and compact page. `server.ts` validates configuration and starts the Node server on port 80. `app/routes.ts` defines routes, `app/router.ts` installs session, static-file and render middleware, `app/actions/` handles pages and auth, and `app/services.ts` filters the catalogue. The face and favicon live in `public/`; the build copies them into `dist/public/` beside the compiled server.

## Configuration

Run from the repository root with Node 26 and `npm ci`. Set `APP_ORIGIN`, `AUTH_ISSUER`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `AUTH_SCOPES`, `AUTH_ORGANIZATION_ID`, `SERVICE_BINDINGS`, and a random `SESSION_SECRET` of at least 32 characters. `PORT` defaults to 80. Credentials and production routing live in Infra; do not commit a real `.env`.

`SERVICE_BINDINGS` is a JSON array of `{id, projectId, requiredAnyRole}` entries. The five original IDs (`jellyfin`, `sonarr`, `radarr`, `prowlarr`, `qbittorrent`) remain required for existing deployments. `navidrome`, `seerr`, `cleanuparr`, and `slskd` are optional. Each needs a project role binding; `seerr` and `slskd` additionally require `allowedSubject`, the exact reviewed owner subject. A role alone never shows those links. Cleanuparr must exactly match the existing Sonarr, Radarr, Prowlarr, and qBittorrent media-admin project, roles, and subject restriction. slskd must match that project and roles, adding its explicit owner restriction when the existing bindings have none; if they already restrict the subject, it must match. A Jellyfin member role does not expose them. An absent or invalid optional binding is hidden or fails configuration validation; Rotund does not grant access at the destination.

`npm run rotund:dev` starts the local server; it needs a separately registered local callback and a matching HTTPS `APP_ORIGIN`. The opt-in `rotund` Compose profile uses the same `ROTUND_*` inputs. The image listens on port 80 to preserve the existing Traefik contract.

## Auth boundary

The app checks existing Jack Auth sign-in once with `prompt=none`; an anonymous visitor then sees the face and Sign in button without a redirect loop. Login uses code, PKCE, state, nonce, signed ID token validation and fresh UserInfo. Access tokens remain server-side. Every directory request checks the exact subject, project, organization and role; names, email and forwarded headers grant nothing. Signed Secure HttpOnly host-only cookies reference bounded one-hour in-memory sessions. Restart clears local sessions and ordinary Jack Auth SSO can restore them. Logout clears only the local portal session.

The session keeps up to four short-lived pending login attempts, keyed by
state. A silent probe and a sign-in started in another tab can finish in either
order without consuming one another.

The Remix CSP middleware gives each HTML response a fresh nonce for generated styles. Scripts stay disabled; forms may submit only to Rotund and the configured issuer. The app keeps its same-origin referrer policy because its sign-in form checks Origin and CSRF.

Jellyfin retains its native login. Navidrome has its own existing Jack Auth entitlement. Seerr uses Jellyfin native login and its link remains restricted to the explicitly linked subject. Cleanuparr retains its native login behind the existing Jack Auth media-admin gate. The slskd (Soulseek) link points to `https://slskd.rotund.org/`, behind the existing Jack Auth owner/media-admin gate with native owner login. Adding its catalogue binding does not activate Soulseek or provision an account. Catalogue visibility is never a promise of destination access.

## Checks

Run `npm run rotund:check`, `npm run build --workspace @harrhy/rotund`, and `npm run test --workspace @harrhy/rotund`. Tests live in `__tests__/`. Build the Dockerfile and run `node scripts/ci/node-image-smoke.mjs rotund <image>` to check the compiled HTTP server and both original image hashes; CI runs this smoke on app changes. Run `npx remix doctor --strict` in this workspace after structural changes. Verify anonymous, owner, restricted and no-grant behaviour against a disposable issuer fixture before rollout. The production switch and any protected binding values are managed outside this repository.
