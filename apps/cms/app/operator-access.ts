import type { User } from "./data/auth.ts";

export interface OperatorAccess {
  redeemTicket(
    siteId: string,
    ticket: string,
  ): { id: string; expiresAt: Date } | null;
  resolveSiteSession(siteId: string, sessionId: string): User | null;
  revokeSiteSession(siteId: string, sessionId: string): void;
}
