import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { schema } from "../db";
import {
  API_SCOPES,
  principalForUser,
  type ApiScope,
  type Principal,
} from "./access";

const TOKEN_PREFIX = "lst_";

export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export function mintApiToken(
  db: Pick<Db, "insert">,
  userId: number,
  name: string,
  scopes: ApiScope[],
  expiresAt: string | null = null,
  audience: string | null = null,
) {
  const uniqueScopes = [...new Set(scopes)].filter((scope) =>
    API_SCOPES.includes(scope),
  );
  if (uniqueScopes.length === 0)
    throw new Error("At least one valid scope is required");

  const secret = `${TOKEN_PREFIX}${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const row = db
    .insert(schema.apiTokens)
    .values({
      userId,
      name: name.trim(),
      tokenHash: hashToken(secret),
      tokenPrefix: secret.slice(0, 12),
      scopes: JSON.stringify(uniqueScopes),
      expiresAt,
      audience,
    })
    .returning()
    .get();

  return { token: secret, credential: row };
}

export function authenticateApiToken(
  db: Db,
  token: string,
  expectedAudience?: string,
): Principal | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const credential = db
    .select()
    .from(schema.apiTokens)
    .where(
      and(
        eq(schema.apiTokens.tokenHash, hashToken(token)),
        isNull(schema.apiTokens.revokedAt),
      ),
    )
    .get();
  if (!credential) return null;
  if (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now())
    return null;
  if (
    expectedAudience !== undefined &&
    credential.audience !== expectedAudience
  )
    return null;

  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, credential.userId))
    .get();
  if (!user) return null;
  const requested = JSON.parse(credential.scopes) as string[];
  const scopes = requested.filter((scope): scope is ApiScope =>
    API_SCOPES.includes(scope as ApiScope),
  );
  db.update(schema.apiTokens)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(schema.apiTokens.id, credential.id))
    .run();
  return { ...principalForUser(db, user, scopes), credentialId: credential.id };
}
