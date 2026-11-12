# @harrhy/identity

Server-side OIDC and API token validation for Jack Auth consumers. `src/index.ts`
uses discovery, PKCE, nonce and `jose` signature validation for browser login, then
checks userinfo against the signed subject and the application's organization and
project roles. It never links a local account by username.

The issuer must be HTTPS. Discovery endpoints must share its origin. Backchannel
requests have a timeout and reject redirects. API introspection requires the
resource server's own credentials and validates issuer, project audience, expiry
and the centrally asserted human/service principal type. Callers still enforce
their required role and scopes before using a principal.

`verifyActedAccessToken` verifies a signed target token's issuer, project
audience, expiry, actor (`act`) and project role claims. Signature verification
does not establish that the token is still active or what scopes it carries.
Introspect the same token with resource credentials, compare its
`TokenPrincipal.actor` and target to the signed claims, then enforce the
consumer's client, role, scope and local-account policy.

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

Run `npm run check --workspace @harrhy/identity`. Tests cover real JWT signatures,
identity substitution, nonce, state, discovery endpoints, organization/project
boundaries and API token expiry. This monorepo develops and checks it on Node 26 LTS. The
package has no browser UI or application database dependency. PKCE, randomness,
and Basic-auth encoding use Web APIs so the server-only module also works in
Worker runtimes. Do not import it into browser assets.
