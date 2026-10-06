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
export function authenticationError(): Error {
  const error = new Error("Authentication rejected");
  error.name = "AuthenticationError";
  return error;
}
/** Unambiguous issuer + subject ownership key. No token, username, or caller-supplied owner. */
export function ownerKey(principal: Principal): string {
  return JSON.stringify([principal.issuer, principal.subject]);
}
