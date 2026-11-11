import {
  createIdentityClient,
  createLoginTransaction,
  IdentityError,
  validLoginTransaction,
  type IdentityConfig,
  type LoginTransaction,
} from "@tea/identity";

export type CentralAuth = { config: IdentityConfig; origin: string };

export function centralAuth(
  origin: string,
  clientId: string | undefined,
): CentralAuth | null {
  const issuer = process.env.TEA_AUTH_ISSUER;
  if (!issuer) return null;
  const projectId = process.env.TEA_AUTH_PROJECT_ID;
  const organizationId = process.env.TEA_AUTH_ORGANIZATION_ID;
  if (!clientId || !projectId || !organizationId)
    throw new Error("CMS Central Auth is incomplete");
  return { config: { issuer, clientId, projectId, organizationId }, origin };
}

function transactionCookie(
  name: string,
  value: string,
  origin: string,
  maxAge: number,
) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin.startsWith("https:") ? "; Secure" : ""}`;
}

function cookieValue(request: Request, name: string) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  );
}

export async function beginCentralLogin(
  auth: CentralAuth,
  callbackPath: string,
  cookieName: string,
) {
  const transaction = createLoginTransaction();
  const authorization = await createIdentityClient(
    auth.config,
  ).authorizationUrl(transaction, `${auth.origin}${callbackPath}`);
  const encoded = btoa(JSON.stringify(transaction))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return new Response(null, {
    status: 303,
    headers: {
      Location: authorization,
      "Set-Cookie": transactionCookie(cookieName, encoded, auth.origin, 600),
      "Cache-Control": "no-store",
    },
  });
}

export async function finishCentralLogin(
  request: Request,
  auth: CentralAuth,
  callbackPath: string,
  cookieName: string,
) {
  const cleared = transactionCookie(cookieName, "", auth.origin, 0);
  const encoded = cookieValue(request, cookieName);
  let transaction: LoginTransaction | null = null;
  if (encoded.length && encoded.length <= 4096) {
    try {
      transaction = JSON.parse(
        atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
      );
    } catch {
      transaction = null;
    }
  }
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (
    !transaction ||
    !validLoginTransaction(transaction, params.get("state")) ||
    !code
  )
    return {
      ok: false as const,
      response: new Response("Sign-in could not be completed", {
        status: 400,
        headers: { "Set-Cookie": cleared },
      }),
    };
  try {
    const profile = await createIdentityClient(auth.config).exchange(
      code,
      transaction,
      `${auth.origin}${callbackPath}`,
    );
    return { ok: true as const, profile, cleared };
  } catch (error) {
    return {
      ok: false as const,
      response: new Response("Sign-in could not be completed", {
        status: error instanceof IdentityError ? error.status : 503,
        headers: { "Set-Cookie": cleared },
      }),
    };
  }
}
