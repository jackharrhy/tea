import * as oidc from "openid-client";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type Transaction = {
  state: string;
  nonce: string;
  verifier: string;
  createdAt: number;
  silent: boolean;
};
export type Login = { subject: string; accessToken: string; expiresAt: number };
export interface Identity {
  begin(transaction: Transaction, silent: boolean): Promise<string> | string;
  exchange(url: URL, transaction: Transaction): Promise<Login>;
  userInfo(login: Login): Promise<Record<string, unknown>>;
}
export type IdentityConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  origin: string;
};
export async function createIdentity(
  config: IdentityConfig,
): Promise<Identity> {
  const server = await oidc.discovery(
    new URL(config.issuer),
    config.clientId,
    undefined,
    oidc.ClientSecretBasic(config.clientSecret),
  );
  const metadata = server.serverMetadata();
  if (
    !metadata.jwks_uri ||
    !metadata.code_challenge_methods_supported?.includes("S256")
  )
    throw new Error("Issuer must support signed identity and S256 PKCE");
  const keys = createRemoteJWKSet(new URL(metadata.jwks_uri));
  return {
    async begin(tx, silent) {
      return oidc.buildAuthorizationUrl(server, {
        redirect_uri: `${config.origin}/auth/callback`,
        scope: config.scopes,
        code_challenge: await oidc.calculatePKCECodeChallenge(tx.verifier),
        code_challenge_method: "S256",
        state: tx.state,
        nonce: tx.nonce,
        ...(silent ? { prompt: "none" } : {}),
      }).href;
    },
    async exchange(url, tx) {
      const tokens = await oidc.authorizationCodeGrant(server, url, {
        pkceCodeVerifier: tx.verifier,
        expectedState: tx.state,
        expectedNonce: tx.nonce,
        idTokenExpected: true,
      });
      if (!tokens.id_token) throw new Error("Missing signed ID token");
      const { payload } = await jwtVerify(tokens.id_token, keys, {
        issuer: config.issuer,
        audience: config.clientId,
        algorithms: ["RS256", "ES256"],
        requiredClaims: ["sub", "exp", "iat", "nonce"],
      });
      const now = Date.now();
      if (
        typeof payload.sub !== "string" ||
        !payload.sub ||
        payload.nonce !== tx.nonce ||
        typeof payload.iat !== "number" ||
        payload.iat > now / 1000 + 60 ||
        payload.iat < now / 1000 - 300
      )
        throw new Error("Invalid identity lifetime or nonce");
      const login = {
        subject: payload.sub,
        accessToken: tokens.access_token,
        expiresAt: Math.min(
          payload.exp! * 1000,
          now + (tokens.expires_in ?? 3600) * 1000,
          now + 3600000,
        ),
      };
      const info = await oidc.fetchUserInfo(
        server,
        login.accessToken,
        login.subject,
      );
      if (info.sub !== login.subject)
        throw new Error("Identity subject mismatch");
      return login;
    },
    async userInfo(login) {
      if (login.expiresAt <= Date.now()) throw new Error("Expired login");
      return await oidc.fetchUserInfo(server, login.accessToken, login.subject);
    },
  };
}
