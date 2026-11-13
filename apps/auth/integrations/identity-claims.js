// SPDX-License-Identifier: AGPL-3.0-only
// oxlint-disable-next-line eslint/no-unused-vars
function jackIdentity(ctx, api) {
  var user = ctx.v1.getUser();
  if (!user) return;
  api.v1.claims.setClaim(
    "jack_auth_principal_type",
    user.human ? "user" : "service",
  );
  api.v1.claims.setClaim("jack_auth_username", user.username);
}
