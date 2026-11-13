# Artbin

Artbin is the game asset archive at [artbin.jackharrhy.dev](https://artbin.jackharrhy.dev). It accepts game assets, organizes folders, generates image and BSP previews, and serves the Artbin CLI. This workspace preserves Artbin's existing name, visual system, routes, and production URL.

## Entry points

`server.ts` starts the Node HTTP server. `app/router.ts` defines Remix routes and middleware, `app/assets.ts` serves browser modules, and `app/ui/` owns the visual system. `/cli` documents the Artbin CLI for visitors; its public guidance matches `apps/artbin-cli/README.md`. `/dev/kitchen-sink` is the live component reference. `src/db/` and `drizzle/` own the SQLite schema and migrations. `src/lib/` owns storage and processing. The CLI lives in `apps/artbin-cli`; shared scan and upload code lives in `packages/artbin-core`.

## Local setup

From the Tea root, run `npm ci`, then `npm run artbin:dev`. Node 26 LTS (26.13.0 or newer), ImageMagick, and Playwright Chromium are needed for all preview paths. Local development uses an administrator account unless `ARTBIN_REQUIRE_AUTH=1`. Set `ARTBIN_DB_PATH`, `ARTBIN_PUBLIC_DIR`, and `ARTBIN_TEMP_DIR` to use separate local data paths; defaults are `data/artbin.db`, `public`, and `tmp/uploads`. See `.env.example` for Jack Auth settings. Set `AUTH_ISSUER`, `AUTH_CLIENT_ID`, `AUTH_PROJECT_ID`, `AUTH_ORGANIZATION_ID` and the resource server's `AUTH_INTROSPECTION_CLIENT_ID` / `AUTH_INTROSPECTION_SECRET`. Production uses `ARTBIN_URL=https://artbin.jackharrhy.dev`. Browser and CLI callbacks are `/auth/callback` and `/auth/cli/callback`.

## Checks and deployment

Run `npm run artbin:check` from the root or `npm run check --workspace @harrhy/artbin-app`. `Dockerfile` produces the Node image published by `.github/workflows/publish-artbin.yml`. Root `compose.yml` provides a local Artbin container. Production host configuration and data migration belong in the infrastructure repo; keep the database and uploads together when changing images. The container expects writable `data`, `public/uploads`, and `tmp/uploads` directories under `/app/apps/artbin`.

Artbin keeps its own UI and storage behavior inside this app. Artbin consumes the Tea map renderer through its public package entry points. Keep its preview behavior, visual assets, and component styles intact when updating the renderer.

Remix 3.2 assigns a fresh CSP nonce to each HTML document, including generated
styles, import maps, and the browser entry. HTML is private and no-store. The
policy permits same-origin media and the preview viewer's runtime style values.

## Central identity rollout

Stop Artbin and back up its SQLite database before applying the reviewed mapping
with Jack Auth's `scripts/link-consumer-identities.py --application artbin`.
The private manifest maps existing 4orm subjects to central subjects; it keeps
Artbin user IDs, asset ownership and folder ownership. Unknown identities and
collisions abort the transaction. Run this before starting the image that applies
`0006_central_identity.sql` and renames the identity column to `auth_subject`.
Never match accounts by username. A fresh database needs no legacy mapping.

The migration clears old browser sessions and CLI handoffs. Members sign in again
through Jack Auth; sessions last at most an hour and never outlive the central
identity proof. CLI handoffs remain single-use and cannot extend expired proof.
Browser and CLI OAuth attempts each keep their state and PKCE verifier in a
separate short-lived cookie, so opening another sign-in tab does not replace an
earlier attempt.
App access requires this project's `member` or `admin` role; administrator actions
use its `admin` role. The former global 4orm admin flag is not an authority here.

API machine tokens require this project's audience, its role claims and the
explicit requested role scopes for `assets-read` or `assets-content`. The Maps
service has only those two roles. MCP requires a human administrator, the `admin`
role scope and the mapped local administrator record. Protected-resource metadata
advertises the central issuer and full required scopes. `@harrhy/identity` verifies
tokens; local sessions, user records and authorization remain in this app.

## Support login

Artbin contains a separate, disabled-by-default support login adapter. The
`/auth/support/start` and `/auth/support/callback` routes use Jack Auth's
one-use, PKCE-bound support handoff; they never create or update an Artbin user.
The target must already have an exact `users.auth_subject` row. The support
token must be a signed native token with the human actor in `act`, an active
resource introspection result for the same target and dedicated support client,
the Artbin project audience and the target's organization-qualified `member` or
`admin` role claim. Native acted JWTs omit `scope`; ordinary browser scopes are
checked on the same token's resource introspection result. This browser check does
not change CLI, machine API or MCP role-scope rules.

Support sessions are held in this Node process for at most ten minutes. Each
support request checks both Jack Auth support status and native introspection
again; an unavailable check denies access. Restarting Artbin invalidates every
support session. A surviving support cookie blocks ordinary-session fallback;
browser navigation goes to `/auth/support/recover` for an explicit
CSRF-protected exit after restart. Exit returns to an existing Artbin session or
starts Jack Auth sign-in when none exists. A rejected callback clears its transaction
cookie and redirects to a code-free problem page; an unlinked local target is
identified there without creating an account. Jack Auth can call the
transport-credential-protected `/auth/support/eligibility` endpoint before starting a
handoff to check whether the target's immutable subject has a local Artbin row;
lookup failure must deny the start.
Callback failures log only the failed verification stage and cleanup state,
without codes, tokens, subjects, callback URLs, or provider response bodies.
The banner names the actor and target, and its exit button ends only the
support session. Normal actor login remains separate. The Auth
service owns durable expiry and native token revocation if Artbin restarts or an
exit request cannot reach it. Mutation logs include actor and target references.
Initial acceptance must make no content changes.

`npm run test:support:browser --workspace @harrhy/artbin-app` additionally runs
Chromium through the recovery form and normal router middleware with synthetic
cookies and an ephemeral loopback HTTP server (no provider or production requests).
Install Playwright Chromium first. Ordinary checks keep this browser probe opt-in.
Support status rejection logs contain only `http`, `inactive`, `identity`, or
`expiry` branch codes; exit rejection logs distinguish `origin` from `csrf`.
They never contain header values, cookies, tokens, subjects, or support references.

Keep `ARTBIN_SUPPORT_LOGIN_ENABLED=0` until the matching Jack Auth support
endpoints, dedicated confidential client, transport credential, native policy
and isolated consumer acceptance are ready. The private production configuration
will need `AUTH_SUPPORT_CLIENT_ID` and a distinct
`AUTH_SUPPORT_TRANSPORT_SECRET`; do not reuse the resource introspection secret.
Set `AUTH_SUPPORT_ORIGIN` to the Jack Auth support HTTP origin; the native
`AUTH_ISSUER` remains the authority for signed tokens and introspection.
