import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { MapsDatabase, MapsUser } from "./database.js";

export interface OAuthConfig {
  readonly fourmUrl: string;
  readonly clientId: string;
  readonly publicUrl: string;
}

const OAuthTokenResponseSchema = z.looseObject({
  access_token: z.string().min(1).max(16_384),
  token_type: z
    .string()
    .refine((value) => value.toLowerCase() === "bearer")
    .optional(),
  expires_in: z.number().finite().positive().optional(),
});
const OAuthProfileSchema = z.looseObject({
  sub: z.string().min(1).max(512),
  username: z.string().min(1).max(256),
  display_name: z.string().min(1).max(256),
  is_admin: z.boolean().default(false),
});
export type OAuthProfile = z.infer<typeof OAuthProfileSchema>;

export function codeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function safeReturnTo(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return "/";
  try {
    const parsed = new URL(value, "https://maps.invalid");
    return parsed.origin === "https://maps.invalid"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : "/";
  } catch {
    return "/";
  }
}

export function beginAuthorization(
  database: MapsDatabase,
  config: OAuthConfig,
  returnTo: string,
): { url: string; state: string } {
  const verifier = codeVerifier();
  const transaction = database.beginOauth(safeReturnTo(returnTo), verifier);
  const redirectUri = `${config.publicUrl}/auth/callback`;
  const url = new URL("/oauth/authorize", config.fourmUrl);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: "openid profile",
    state: transaction.state,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), state: transaction.state };
}

export function consumeAuthorizationTransaction(input: {
  readonly database: MapsDatabase;
  readonly state: string;
  readonly cookieState: string | undefined;
}): { verifier: string; returnTo: string } {
  if (!input.cookieState || input.cookieState !== input.state)
    throw Object.assign(new Error("OAuth state mismatch"), { status: 400 });
  const transaction = input.database.consumeOauth(input.state);
  if (!transaction)
    throw Object.assign(new Error("OAuth transaction is missing or expired"), {
      status: 400,
    });
  return transaction;
}

export async function completeAuthorization(input: {
  readonly database: MapsDatabase;
  readonly config: OAuthConfig;
  readonly state: string;
  readonly code: string;
  readonly cookieState: string | undefined;
  readonly fetch: typeof globalThis.fetch;
}): Promise<{ user: MapsUser; returnTo: string }> {
  const transaction = consumeAuthorizationTransaction(input);
  const tokenResponse = await input.fetch(
    new URL("/oauth/token", input.config.fourmUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: `${input.config.publicUrl}/auth/callback`,
        client_id: input.config.clientId,
        code_verifier: transaction.verifier,
      }),
    },
  );
  if (!tokenResponse.ok)
    throw new Error(`4orm token exchange failed (${tokenResponse.status})`);
  const tokenPayload = OAuthTokenResponseSchema.safeParse(
    await tokenResponse.json(),
  );
  if (!tokenPayload.success)
    throw new Error("4orm returned an invalid access token response");
  const profileResponse = await input.fetch(
    new URL("/oauth/userinfo", input.config.fourmUrl),
    {
      headers: { Authorization: `Bearer ${tokenPayload.data.access_token}` },
    },
  );
  if (!profileResponse.ok)
    throw new Error(`4orm userinfo failed (${profileResponse.status})`);
  const profile = OAuthProfileSchema.safeParse(await profileResponse.json());
  if (!profile.success) throw new Error("4orm returned invalid userinfo");
  return {
    user: input.database.upsertUser({
      fourmSub: profile.data.sub,
      username: profile.data.username,
      displayName: profile.data.display_name,
      isAdmin: profile.data.is_admin,
    }),
    returnTo: transaction.returnTo,
  };
}
