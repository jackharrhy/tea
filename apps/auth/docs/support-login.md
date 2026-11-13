# Artbin support login (held)

The feature is disabled unless `AUTH_SUPPORT_CONFIG_FILE` explicitly enables it. No native policy, client, permission, or grant is created by this source. Production remains off pending checked source, native preflight and integrated Artbin acceptance.

Only the explicitly configured reviewed human `actorSubject`, who must also be an Auth administrator, selects an existing target, supplies a reason, and starts from `/manage/people/:id/support`. Auth binds a two-minute opaque request to that administrator, target, and Artbin. Artbin supplies its own state, nonce and S256 challenge. Auth then completes a genuine native actor OIDC code flow and creates a sixty-second, single-use handoff code. Redemption binds the consumer's verifier and callback before a single native token exchange.

The native acted JWT must contain the Artbin numeric project audience **and the dedicated support client audience**. ZITADEL 4.20 checks the revoking client's audience membership: a project-only audience cannot meet the cleanup contract. The actor receives no Artbin grant. The target's existing org-qualified member/admin role is verified independently in the signed JWT and same-token resource introspection. Browser scopes come from introspection; JWT `scope` is not required. Native principal evidence must explicitly identify a human.

Artbin receives no ordinary target Auth session. Its separate memory-only support session expires after at most ten minutes, carries an actor/target banner, and requires fresh Auth status and native introspection on each request. The adapter preserves its normal actor session, never creates a local target, and never updates local administrator flags. API bearer, CLI and MCP policies are unchanged.

## Persistence and cleanup

`support_lifecycle` shares the existing `access.sqlite` recovery boundary. AES-256-GCM with record-bound associated data encrypts bearer material, actor proof, capability hashes and reason. Opaque request/code/session references are hashed at rest. Token ownership transfers atomically between lifecycle records.

Exit marks the lifecycle inactive before native revocation. Revocation is only confirmed after same-token native introspection is inactive and UserInfo returns 401. Failure retains encrypted material for the periodic, restart-safe cleanup sweep. Expiry, disabling new support login, or loss of Auth-admin/target eligibility also ends support. Keep the private configuration and encryption key available while disabling: the cleanup worker and authenticated end/status remain available even when new handoffs are disabled. Unknown interrupted exchange outcomes are never replayed and block new starts for operator audit. No credentials, accounts or grants are reset to resolve an unknown outcome.

The private configuration file requires: `enabled`, exact immutable `actorSubject`, `issuer`, `clientId`, `clientSecret`, a 32-byte base64url `encryptionKey`, and `consumers.artbin` with `origin`, exact `callback`, `projectId`, `organizationId`, `resourceClientId`, `resourceSecret`, and a distinct random support `transportSecret`. Protect this file separately from the DB and include it in sealed recovery before deployment. Existing key mounts and native configuration remain unchanged. The Artbin transport credential is never the native resource BASIC credential.

## Routes

- Authenticated Origin/CSRF-protected admin form: `GET/POST /manage/people/:id/support`.
- Authenticated actor browser flow: `GET /support/handoff`, `GET /support/callback`.
- Separate consumer Basic authentication, JSON/no-store: `POST /support/redeem`, `/support/session`, `/support/end`.
- `/support/end` is idempotent with the same valid consumer and per-session capability; returns `active:false` plus `revocation:confirmed|pending`.

Local native fixture proofs are distinct from actual Artbin acceptance or production human login. Neither redirect checks nor synthetic sessions close a genuine human acceptance gate.
