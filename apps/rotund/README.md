# Rotund

Rotund is the small Remix 3 service directory at `https://rotund.org`. It keeps the original face and compact page. `server.ts` validates configuration and starts the Node server on port 80. `app/routes.ts` defines routes, `app/router.ts` installs session, static-file and render middleware, `app/actions/` handles pages and auth, and `app/services.ts` filters the catalogue. The face and favicon live in `public/`; the build copies them into `dist/public/` beside the compiled server. `app/actions/home-page.tsx` presents only the entitlement-filtered services it receives: Jellyfin, Seerr and Navidrome first, then a smaller Management group when any management links are visible. Official service SVGs and their pinned provenance/license notices live in `public/services/`; no logo or font is fetched from a third party at runtime.

## Configuration

Run from the repository root with Node 26 and `npm ci`. Set `APP_ORIGIN`, `AUTH_ISSUER`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `AUTH_SCOPES`, `AUTH_ORGANIZATION_ID`, `SERVICE_BINDINGS`, and a random `SESSION_SECRET` of at least 32 characters. `PORT` defaults to 80. Credentials and production routing live in Infra; do not commit a real `.env`.

`SERVICE_BINDINGS` is a JSON array of `{id, projectId, requiredAnyRole}` entries. The five original IDs (`jellyfin`, `sonarr`, `radarr`, `prowlarr`, `qbittorrent`) remain required for existing deployments. `navidrome`, `seerr`, `cleanuparr`, and `slskd` are optional. Each needs a project role binding. Seerr may use the exact existing Jellyfin media-member binding without a subject pin; an unrelated project or role is rejected. An existing subject-pinned Seerr binding remains supported for staged configuration changes. `slskd` requires `allowedSubject`, the exact reviewed owner subject. Cleanuparr must exactly match the existing Sonarr, Radarr, Prowlarr, and qBittorrent media-admin project, roles, and subject restriction. slskd must match that project and roles, adding its explicit owner restriction when the existing bindings have none; if they already restrict the subject, it must match. A Jellyfin member role does not expose them. An absent or invalid optional binding is hidden or fails configuration validation; Rotund does not grant access at the destination.

`npm run rotund:dev` starts the local server; it needs a separately registered local callback and a matching HTTPS `APP_ORIGIN`. The opt-in `rotund` Compose profile uses the same `ROTUND_*` inputs. The image listens on port 80 to preserve the existing Traefik contract.

## Auth boundary

The app checks existing Jack Auth sign-in once with `prompt=none`; an anonymous visitor then sees the face and Sign in button without a redirect loop. Login uses code, PKCE, state, nonce, signed ID token validation and fresh UserInfo. Access tokens remain server-side. Every directory request checks the exact subject, project, organization and role; names, email and forwarded headers grant nothing. Signed Secure HttpOnly host-only cookies reference bounded one-hour in-memory sessions. Restart clears local sessions and ordinary Jack Auth SSO can restore them. Logout clears only the local portal session.

The session keeps up to four short-lived pending login attempts, keyed by
state. A silent probe and a sign-in started in another tab can finish in either
order without consuming one another.

The Remix CSP middleware gives each HTML response a fresh nonce for generated styles. Scripts stay disabled; forms may submit only to Rotund and the configured issuer. The app keeps its same-origin referrer policy because its sign-in form checks Origin and CSRF.

Jellyfin retains its native login. Navidrome has its own existing Jack Auth entitlement. Seerr uses Jellyfin native login. Its directory link can be visible to existing media members, but reviewed native Jellyfin users still need to be imported into Seerr. Approved media members receive request and automatic-approval permissions, not administrative access. Directory eligibility does not provision native accounts. Cleanuparr retains its native login behind the existing Jack Auth media-admin gate. The slskd (Soulseek) link points to `https://slskd.rotund.org/`, behind the existing Jack Auth owner/media-admin gate with native owner login. Adding its catalogue binding does not activate Soulseek or provision an account. Catalogue visibility is never a promise of destination access.

## Checks

Run `npm run rotund:check`, `npm run build --workspace @harrhy/rotund`, and `npm run test --workspace @harrhy/rotund`. Tests live in `__tests__/`. Build the Dockerfile and run `node scripts/ci/node-image-smoke.mjs rotund <image>` to check the compiled HTTP server and both original image hashes; CI runs this smoke on app changes. Run `npx remix doctor --strict` in this workspace after structural changes. Verify anonymous, owner, restricted and no-grant behaviour against a disposable issuer fixture before rollout. The production switch and any protected binding values are managed outside this repository.
