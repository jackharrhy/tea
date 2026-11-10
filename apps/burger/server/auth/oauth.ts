import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type Userinfo = {
  sub: string;
  preferred_username: string;
  name?: string;
  [claim: string]: unknown;
};

export type AuthIdentity = {
  subject: string;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token: string;
};

export type ProviderMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  revocation_endpoint: string;
  jwks_uri: string;
};

const requireProviderUrl = (value: unknown, issuer: URL): string => {
  if (typeof value !== "string")
    throw new Error("provider endpoint is missing");
  const endpoint = new URL(value);
  if (
    endpoint.origin !== issuer.origin ||
    endpoint.protocol !== issuer.protocol
  ) {
    throw new Error("provider endpoint is outside the configured issuer");
  }
  return endpoint.toString();
};

export const discoverProvider = async (
  issuerUrl: string,
): Promise<ProviderMetadata> => {
  const issuer = new URL(issuerUrl);
  const discoveryUrl = new URL("/.well-known/openid-configuration", issuer);
  const response = await fetch(discoveryUrl);
  if (!response.ok) throw new Error("provider discovery failed");
  const value = (await response.json()) as Record<string, unknown>;
  if (value.issuer !== issuerUrl) throw new Error("provider issuer mismatch");
  return {
    issuer: issuerUrl,
    authorization_endpoint: requireProviderUrl(
      value.authorization_endpoint,
      issuer,
    ),
    token_endpoint: requireProviderUrl(value.token_endpoint, issuer),
    userinfo_endpoint: requireProviderUrl(value.userinfo_endpoint, issuer),
    revocation_endpoint: requireProviderUrl(value.revocation_endpoint, issuer),
    jwks_uri: requireProviderUrl(value.jwks_uri, issuer),
  };
};

export const generateCodeVerifier = (): string =>
  randomBytes(32).toString("base64url");

export const generateCodeChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

export const exchangeCode = async (args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  tokenUrl: string;
  clientId: string;
}): Promise<TokenResponse> => {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    code_verifier: args.codeVerifier,
  });

  const res = await fetch(args.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
};

export const fetchUserinfo = async (args: {
  accessToken: string;
  userinfoUrl: string;
}): Promise<Userinfo> => {
  const res = await fetch(args.userinfoUrl, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`userinfo fetch failed (${res.status})`);
  }

  return res.json() as Promise<Userinfo>;
};

export const verifyIdToken = async (args: {
  idToken: string;
  issuer: string;
  clientId: string;
  nonce: string;
  jwksUri: string;
}): Promise<string> => {
  const { payload } = await jwtVerify(
    args.idToken,
    createRemoteJWKSet(new URL(args.jwksUri)),
    {
      issuer: args.issuer,
      audience: args.clientId,
    },
  );
  if (payload.nonce !== args.nonce || typeof payload.sub !== "string") {
    throw new Error("ID token binding failed");
  }
  return payload.sub;
};

export const revokeAccessToken = async (args: {
  accessToken: string;
  revocationUrl: string;
  clientId: string;
}): Promise<void> => {
  const body = new URLSearchParams({
    token: args.accessToken,
    token_type_hint: "access_token",
    client_id: args.clientId,
  });
  const response = await fetch(args.revocationUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) throw new Error("access token revocation failed");
};

export const parseUserinfo = (
  userinfo: Userinfo,
  projectId: string,
  organizationId: string,
  verifiedSubject?: string,
): AuthIdentity => {
  if (
    typeof userinfo.sub !== "string" ||
    !userinfo.sub ||
    typeof userinfo.preferred_username !== "string" ||
    !userinfo.preferred_username
  ) {
    throw new Error("userinfo is missing required identity claims");
  }
  if (verifiedSubject !== undefined && userinfo.sub !== verifiedSubject) {
    throw new Error("userinfo subject does not match the ID token");
  }

  const roleClaim = userinfo[`urn:zitadel:iam:org:project:${projectId}:roles`];
  const hasOrganizationRole = (role: string): boolean => {
    if (
      !roleClaim ||
      typeof roleClaim !== "object" ||
      Array.isArray(roleClaim)
    ) {
      return false;
    }
    const organizations = (roleClaim as Record<string, unknown>)[role];
    return (
      !!organizations &&
      typeof organizations === "object" &&
      !Array.isArray(organizations) &&
      Object.hasOwn(organizations, organizationId)
    );
  };
  const isMember = hasOrganizationRole("member");
  const isAdmin = hasOrganizationRole("admin");

  if (!isMember && !isAdmin) {
    throw new Error("userinfo is missing Burger membership");
  }

  return {
    subject: userinfo.sub,
    username: userinfo.preferred_username,
    displayName: typeof userinfo.name === "string" ? userinfo.name : null,
    isAdmin,
  };
};
