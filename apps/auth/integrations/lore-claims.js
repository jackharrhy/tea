// SPDX-License-Identifier: AGPL-3.0-only
// Provisioning substitutes the configured Lore project ID before uploading.
// oxlint-disable-next-line eslint/no-unused-vars
function loreClaims(ctx, api) {
  if (ctx.v1.application.getClientId() !== LORE_CLIENT_ID) return;
  var user = ctx.v1.getUser();
  api.v1.claims.setClaim("preferred_username", user.username);
  api.v1.claims.setClaim(
    "name",
    user.human ? user.human.displayName : user.username,
  );
  var roles = [];
  if (ctx.v1.user.grants)
    ctx.v1.user.grants.grants.forEach(function (grant) {
      if (grant.projectId === PROJECT_ID) roles = roles.concat(grant.roles);
    });
  api.v1.claims.setClaim("lore_roles", roles);
  api.v1.claims.setClaim("root_domains", ["lore.jackharrhy.dev"]);
}
