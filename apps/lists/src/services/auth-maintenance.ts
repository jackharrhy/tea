import { lt } from "drizzle-orm";
import type { Db } from "../db";
import { schema } from "../db";

export function cleanupExpiredAuthRecords(db: Db, now = new Date()) {
  const cutoff = now.toISOString();
  const sessions = db
    .select({ tokenHash: schema.sessions.tokenHash })
    .from(schema.sessions)
    .where(lt(schema.sessions.expiresAt, cutoff))
    .all();
  const authorizationCodes = db
    .select({ id: schema.oauthAuthorizationCodes.id })
    .from(schema.oauthAuthorizationCodes)
    .where(lt(schema.oauthAuthorizationCodes.expiresAt, cutoff))
    .all();
  const refreshTokens = db
    .select({ id: schema.oauthRefreshTokens.id })
    .from(schema.oauthRefreshTokens)
    .where(lt(schema.oauthRefreshTokens.expiresAt, cutoff))
    .all();

  db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, cutoff)).run();
  db.delete(schema.oauthAuthorizationCodes)
    .where(lt(schema.oauthAuthorizationCodes.expiresAt, cutoff))
    .run();
  db.delete(schema.oauthRefreshTokens)
    .where(lt(schema.oauthRefreshTokens.expiresAt, cutoff))
    .run();

  return {
    sessions: sessions.length,
    authorizationCodes: authorizationCodes.length,
    refreshTokens: refreshTokens.length,
  };
}
