# @tea/identity

Server-side OIDC and API token validation for Jack Auth consumers. `src/index.ts`
uses discovery, PKCE, nonce and `jose` signature validation for browser login, then
checks userinfo against the signed subject and the application's organization and
project roles. It never links a local account by username.

The issuer must be HTTPS. Discovery endpoints must share its origin. Backchannel
requests have a timeout and reject redirects. API introspection requires the
resource server's own credentials and validates issuer, project audience, expiry
and the centrally asserted human/service principal type. Callers still enforce
their required role and scopes before using a principal.

Provide issuer, client ID, project ID and organization ID in `IdentityConfig`.
Create and store a `LoginTransaction`, redirect with `authorizationUrl`, validate
browser state with `validLoginTransaction`, and consume the transaction once
before calling `exchange`. Keep transaction storage and local sessions in the
app. Keep resource-server credentials in its server-only configuration.

Jack Auth's `jackIdentity` action supplies `jack_auth_username` and
`jack_auth_principal_type`. Roles come from the project-specific reserved ZITADEL
claim and must belong to the configured organization. Standard audience and role
scopes are exported for protected-resource metadata and machine token requests.
An audience grants no permission by itself.

Run `npm run check --workspace @tea/identity`. Tests cover real JWT signatures,
identity substitution, nonce, state, discovery endpoints, organization/project
boundaries and API token expiry. The package uses Web Crypto and Node crypto on
Node 24 or newer; it has no browser UI or application database dependency.
