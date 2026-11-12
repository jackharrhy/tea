import {
  createIdentityClient,
  createLoginTransaction,
  type IdentityConfig,
  type LoginTransaction,
} from "@harrhy/identity";
import type { MapsDatabase, MapsUser } from "./database.js";

export interface OAuthConfig extends IdentityConfig {
  readonly publicUrl: string;
}

function safeReturnTo(value: string | null): string {
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

export async function beginAuthorization(
  database: MapsDatabase,
  config: OAuthConfig,
  returnTo: string,
  fetcher: typeof fetch = fetch,
): Promise<{ url: string; state: string }> {
  const transaction = createLoginTransaction();
  database.beginOauth(safeReturnTo(returnTo), transaction);
  const url = await createIdentityClient(config, fetcher).authorizationUrl(
    transaction,
    `${config.publicUrl}/auth/callback`,
  );
  return { url, state: transaction.state };
}

export function consumeAuthorizationTransaction(input: {
  readonly database: MapsDatabase;
  readonly state: string;
  readonly cookieState: string | undefined;
}): { transaction: LoginTransaction; returnTo: string } {
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
  readonly fetch: typeof fetch;
}): Promise<{ user: MapsUser; returnTo: string; proofExpiresAt: number }> {
  const { transaction, returnTo } = consumeAuthorizationTransaction(input);
  const profile = await createIdentityClient(
    input.config,
    input.fetch,
  ).exchange(
    input.code,
    transaction,
    `${input.config.publicUrl}/auth/callback`,
  );
  return {
    user: input.database.upsertUser({
      authSubject: profile.subject,
      username: profile.username,
      displayName: profile.displayName,
      isAdmin: profile.roles.has("admin"),
    }),
    returnTo,
    proofExpiresAt: profile.expiresAt,
  };
}
