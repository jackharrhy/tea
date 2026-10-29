import { createIdentityClient, type IdentityConfig } from "@tea/identity";

export { createLoginTransaction, validLoginTransaction } from "@tea/identity";
export type { LoginTransaction } from "@tea/identity";

export function identityConfig(): IdentityConfig {
  return {
    issuer: process.env.AUTH_ISSUER ?? "https://auth.jackharrhy.dev",
    clientId: process.env.AUTH_CLIENT_ID ?? "",
    projectId: process.env.AUTH_PROJECT_ID ?? "",
    organizationId: process.env.AUTH_ORGANIZATION_ID ?? "",
  };
}
export function identityClient() {
  return createIdentityClient(identityConfig(), (input, options) =>
    fetch(input, options),
  );
}
export function browserRedirectUri(): string {
  return `${process.env.ARTBIN_URL ?? "http://localhost:5175"}/auth/callback`;
}
export function getCliRedirectUri(): string {
  return `${process.env.ARTBIN_URL ?? "http://localhost:5175"}/auth/cli/callback`;
}
