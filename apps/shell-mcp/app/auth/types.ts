export type Principal = Readonly<{
  issuer: string;
  subject: string;
  username: string;
  admin: boolean;
  expiresAt: number;
}>;
export interface IdentityProvider {
  verify(bearerToken: string): Promise<Principal>;
}
export class AuthenticationError extends Error {
  constructor() {
    super("Authentication rejected");
    this.name = "AuthenticationError";
  }
}
/** Unambiguous issuer + subject ownership key. No token, username, or caller-supplied owner. */
export function ownerKey(principal: Principal): string {
  return JSON.stringify([principal.issuer, principal.subject]);
}
