export type AuthConfig = {
  issuerUrl: string;
  burgerUrl: string;
  clientId: string;
  projectId: string;
  isProduction: boolean;
};

export const loadAuthConfig = (env = process.env): AuthConfig => {
  if (!env.AUTH_CLIENT_ID || !env.AUTH_PROJECT_ID) {
    throw new Error("AUTH_CLIENT_ID and AUTH_PROJECT_ID are required");
  }

  const issuerUrl = env.AUTH_ISSUER ?? "https://auth.jackharrhy.dev";
  if (
    env.NODE_ENV === "production" &&
    new URL(issuerUrl).protocol !== "https:"
  ) {
    throw new Error("AUTH_ISSUER must use HTTPS in production");
  }

  return {
    issuerUrl,
    burgerUrl: env.BURGER_URL ?? "http://localhost:5000",
    clientId: env.AUTH_CLIENT_ID,
    projectId: env.AUTH_PROJECT_ID,
    isProduction: env.NODE_ENV === "production",
  };
};

export const BURGER_ORGANIZATION_ID = "396722364273983491";

export const buildRedirectUri = (cfg: AuthConfig): string =>
  `${cfg.burgerUrl}/auth/4orm/callback`;

export const buildScopes = (cfg: AuthConfig): string =>
  [
    "openid",
    "profile",
    `urn:zitadel:iam:org:project:id:${cfg.projectId}:aud`,
    "urn:zitadel:iam:org:projects:roles",
  ].join(" ");
