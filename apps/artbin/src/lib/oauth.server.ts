import crypto from "node:crypto";

const FOURM_BASE_URL = process.env.FOURM_URL ?? "http://localhost:8000";
const FOURM_CLIENT_ID = process.env.FOURM_CLIENT_ID ?? "artbin";
const ARTBIN_BASE_URL = process.env.ARTBIN_URL ?? "http://localhost:5175";

export const FOURM_AUTHORIZE_URL = `${FOURM_BASE_URL}/oauth/authorize`;
export const FOURM_TOKEN_URL = `${FOURM_BASE_URL}/oauth/token`;
export const FOURM_USERINFO_URL = `${FOURM_BASE_URL}/oauth/userinfo`;
export const FOURM_REDIRECT_URI = `${ARTBIN_BASE_URL}/auth/4orm/callback`;

export { FOURM_CLIENT_ID };

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function getCliRedirectUri(): string {
  return `${ARTBIN_BASE_URL}/auth/cli/callback`;
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string = FOURM_REDIRECT_URI,
): Promise<{ access_token: string; token_type: string; expires_in: number }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: FOURM_CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const response = await fetch(FOURM_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${err}`);
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error("Token exchange returned an invalid response");
  }

  const { access_token, token_type, expires_in } = payload as Record<
    string,
    unknown
  >;
  if (typeof access_token !== "string" || access_token.length === 0) {
    throw new Error("Token exchange returned an invalid access_token");
  }
  if (
    token_type !== undefined &&
    (typeof token_type !== "string" || !/^bearer$/i.test(token_type))
  ) {
    throw new Error("Token exchange returned an unsupported token_type");
  }
  if (
    typeof expires_in !== "number" ||
    !Number.isFinite(expires_in) ||
    expires_in <= 0
  ) {
    throw new Error("Token exchange returned an invalid expires_in");
  }

  return { access_token, token_type: token_type ?? "Bearer", expires_in };
}

export async function fetchUserinfo(accessToken: string): Promise<{
  sub: string;
  username: string;
  display_name: string;
  is_admin: boolean;
}> {
  const response = await fetch(FOURM_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Userinfo fetch failed (${response.status})`);
  }

  return response.json();
}
