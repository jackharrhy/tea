import * as s from "remix/data-schema";
import { authenticationError, type Principal } from "./types.ts";

export type OwnerPolicy = Readonly<{
  issuer: string;
  resource: string;
  requiredScope: string;
  allowedSubjects: readonly string[];
  allowedUsernames: readonly string[];
}>;

const introspectionSchema = s.object({
  active: s.literal(true),
  principal_type: s.literal("user"),
  sub: s.string(),
  token_type: s.string(),
  client_id: s.string(),
  aud: s.union([s.string(), s.array(s.string())]),
  scope: s.string(),
  exp: s.number().refine(Number.isSafeInteger),
  iat: s.number().refine(Number.isSafeInteger),
  iss: s.optional(s.string()),
});

const userinfoSchema = s.object({
  sub: s.string(),
  username: s.string(),
  is_admin: s.literal(true),
});

type VerifiedToken = Readonly<{ subject: string; expiresAt: number }>;

export function verifyIntrospection(
  input: unknown,
  policy: OwnerPolicy,
  now: number,
): VerifiedToken {
  const result = s.parseSafe(introspectionSchema, input);
  if (!result.success) throw authenticationError();
  const claims = result.value;

  if (!policy.allowedSubjects.includes(claims.sub)) throw authenticationError();
  if (claims.token_type.toLowerCase() !== "bearer" || !claims.client_id)
    throw authenticationError();

  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (audiences.length !== 1 || audiences[0] !== policy.resource)
    throw authenticationError();

  const scopes = new Set(claims.scope.split(" "));
  if (!scopes.has("openid") || !scopes.has(policy.requiredScope))
    throw authenticationError();

  const currentSeconds = Math.floor(now / 1000);
  if (
    claims.exp <= currentSeconds ||
    claims.iat > currentSeconds + 5 ||
    claims.iat >= claims.exp
  )
    throw authenticationError();
  if (claims.iss !== undefined && claims.iss !== policy.issuer)
    throw authenticationError();

  return { subject: claims.sub, expiresAt: claims.exp * 1000 };
}

export function verifyUserinfo(
  input: unknown,
  token: VerifiedToken,
  policy: OwnerPolicy,
  now: number,
): Principal {
  const result = s.parseSafe(userinfoSchema, input);
  if (!result.success) throw authenticationError();
  const profile = result.value;

  if (profile.sub !== token.subject) throw authenticationError();
  if (!policy.allowedUsernames.includes(profile.username))
    throw authenticationError();
  if (token.expiresAt <= now) throw authenticationError();

  return Object.freeze({
    issuer: policy.issuer,
    subject: token.subject,
    username: profile.username,
    admin: true,
    expiresAt: token.expiresAt,
  });
}
