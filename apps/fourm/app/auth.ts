import {
  createIdentityClient,
  createLoginTransaction,
  validLoginTransaction,
  roleScope,
} from "@harrhy/identity";
import type { IdentityConfig, LoginTransaction } from "@harrhy/identity";
import { CommunityError } from "./data/community.ts";
import { cookie, hash, readCookie, token } from "./runtime.ts";
import type { Bindings, Runtime } from "./runtime.ts";

export function identityConfig(env: Bindings): IdentityConfig {
  return {
    issuer: env.AUTH_ISSUER,
    clientId: env.AUTH_CLIENT_ID,
    projectId: env.AUTH_PROJECT_ID,
    organizationId: env.AUTH_ORGANIZATION_ID,
  };
}
export async function startLogin(
  env: Bindings,
  store: Runtime,
  enrollmentId?: string | null,
) {
  const transaction = createLoginTransaction();
  const destination = await createIdentityClient(
    identityConfig(env),
  ).authorizationUrl(transaction, `${env.AUTH_PUBLIC_ORIGIN}/auth/callback`);
  await store.call(
    "saveLogin",
    await hash(transaction.state),
    JSON.stringify({ ...transaction, enrollmentId: enrollmentId ?? null }),
  );
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination,
      "Set-Cookie": cookie(env, "fourm_oauth", transaction.state, 600),
    },
  });
}
export async function finishLogin(
  request: Request,
  env: Bindings,
  store: Runtime,
  completed: (id: string) => void,
) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const headers = new Headers({
    "Set-Cookie": cookie(env, "fourm_oauth", "", 0),
  });
  if (!state || state !== readCookie(request, "fourm_oauth") || !code)
    return new Response("Sign-in expired. Start again.", {
      status: 400,
      headers,
    });
  const body = await store.call("consumeLogin", await hash(state));
  if (!body)
    return new Response("Sign-in was already used or expired. Start again.", {
      status: 400,
      headers,
    });
  const transaction = JSON.parse(body) as LoginTransaction & {
    enrollmentId?: string | null;
  };
  if (!validLoginTransaction(transaction, state))
    return new Response("Invalid sign-in", { status: 400, headers });
  const profile = await createIdentityClient(identityConfig(env)).exchange(
    code,
    transaction,
    `${env.AUTH_PUBLIC_ORIGIN}/auth/callback`,
  );
  const member = transaction.enrollmentId
    ? await store.call(
        "finishEnrollment",
        transaction.enrollmentId,
        env.AUTH_ISSUER,
        profile.subject,
      )
    : await store.call("resolveIdentity", env.AUTH_ISSUER, profile.subject);
  const session = token();
  await store.call(
    "createSession",
    await hash(session),
    member.id,
    profile.expiresAt * 1000,
  );
  headers.append("Set-Cookie", cookie(env, "fourm_session", session, 3600));
  if (transaction.enrollmentId) {
    headers.append("Set-Cookie", cookie(env, "fourm_enrollment", "", 0));
    completed(transaction.enrollmentId);
  }
  headers.set(
    "Location",
    transaction.enrollmentId && !member.has_accepted_trust
      ? "/trust-agreement"
      : `/u/${encodeURIComponent(member.username)}`,
  );
  return new Response(null, { status: 303, headers });
}
export async function bearer(
  request: Request,
  env: Bindings,
  permission?: string,
) {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer "))
    throw new CommunityError(401, "Bearer token required");
  if (!env.AUTH_INTROSPECTION_CLIENT_ID || !env.AUTH_INTROSPECTION_SECRET)
    throw new CommunityError(503, "API token validation is not configured");
  const principal = await createIdentityClient(identityConfig(env)).introspect(
    header.slice(7),
    {
      clientId: env.AUTH_INTROSPECTION_CLIENT_ID,
      clientSecret: env.AUTH_INTROSPECTION_SECRET,
    },
  );
  if (principal.principalType !== "user" || !principal.roles.has("member"))
    throw new CommunityError(403, "A human member token is required");
  if (
    permission &&
    (!principal.roles.has(permission) ||
      !principal.scopes.has(roleScope(permission)))
  )
    throw new CommunityError(403, `Missing ${permission} permission`);
  return principal;
}
