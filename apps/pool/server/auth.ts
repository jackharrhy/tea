import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { z } from "zod";

export type AuthSession = Readonly<{
  subject: string;
  issuer: string;
  name: string;
  owner: boolean;
  csrf: string;
  expiresAt: number;
}>;
type Transaction = {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
};
const token = () => randomBytes(32).toString("base64url");
const sessionCookie = "__Host-8ball-session";
const transactionCookie = "__Host-8ball-login";
function cookie(req: Request, name: string) {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name + "="))
    ?.slice(name.length + 1);
}
function setCookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}
function prune<T extends { expiresAt: number }>(entries: Map<string, T>) {
  for (const [key, value] of entries)
    if (value.expiresAt <= Date.now()) entries.delete(key);
}
const httpsOriginSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
});
const authConfigSchema = z.object({
  AUTH_ISSUER: httpsOriginSchema,
  AUTH_CLIENT_ID: z.string().min(1),
  PUBLIC_ORIGIN: httpsOriginSchema,
  AUTH_CLIENT_SECRET: z.string().optional(),
});
const tokenResponseSchema = z.object({ id_token: z.string() });
async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing provider response");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 262_144) {
        await reader.cancel();
        throw new Error("Provider response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function createAuth(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
) {
  const sessions = new Map<string, AuthSession>();
  const transactions = new Map<string, Transaction>();
  const parsedConfig = authConfigSchema.safeParse(env);
  const config = parsedConfig.success
    ? {
        issuer: parsedConfig.data.AUTH_ISSUER,
        clientId: parsedConfig.data.AUTH_CLIENT_ID,
        origin: parsedConfig.data.PUBLIC_ORIGIN,
        secret: parsedConfig.data.AUTH_CLIENT_SECRET,
      }
    : undefined;
  const ownerSubject = env.OWNER_SUBJECT;
  let metadata:
    | {
        authorization: string;
        token: string;
        keys: ReturnType<typeof createRemoteJWKSet>;
        expiresAt: number;
      }
    | undefined;
  async function request(url: string | URL, init: RequestInit = {}) {
    return fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  }
  async function discovery() {
    if (!config) throw new Error("Sign-in disabled");
    if (metadata && metadata.expiresAt > Date.now()) return metadata;
    const response = await request(
      config.issuer + "/.well-known/openid-configuration",
    );
    if (!response.ok) throw new Error("Discovery failed");
    const endpointSchema = z.string().refine((value) => {
      try {
        const url = new URL(value);
        return (
          url.origin === config.issuer &&
          !url.username &&
          !url.password &&
          !url.hash
        );
      } catch {
        return false;
      }
    });
    const doc = z
      .object({
        issuer: z.literal(config.issuer),
        authorization_endpoint: endpointSchema,
        token_endpoint: endpointSchema,
        jwks_uri: endpointSchema,
      })
      .parse(await readJson(response));
    metadata = {
      authorization: doc.authorization_endpoint,
      token: doc.token_endpoint,
      keys: createRemoteJWKSet(new URL(doc.jwks_uri), {
        [customFetch]: (url, init) => request(url, init),
        timeoutDuration: 5000,
      }),
      expiresAt: Date.now() + 300_000,
    };
    return metadata;
  }
  async function session(req: Request): Promise<AuthSession | null> {
    prune(sessions);
    return sessions.get(cookie(req, sessionCookie) ?? "") ?? null;
  }
  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (
      ![
        "/api/account",
        "/auth/login",
        "/auth/callback",
        "/auth/logout",
      ].includes(url.pathname)
    )
      return null;
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    const reply = (message: string, status: number) =>
      new Response(message, { status, headers });
    const redirect = (location: string) => {
      headers.set("Location", location);
      return new Response(null, { status: 303, headers });
    };
    if (url.pathname === "/api/account") {
      if (req.method !== "GET") return reply("Method not allowed", 405);
      const account = await session(req);
      return Response.json(
        {
          enabled: !!config,
          authenticated: !!account,
          name: account?.name ?? null,
          owner: account?.owner ?? false,
          csrf: account?.csrf ?? null,
        },
        { headers },
      );
    }
    if (url.pathname === "/auth/logout") {
      if (req.method !== "POST") return reply("Method not allowed", 405);
      const account = await session(req);
      if (
        !config ||
        !account ||
        req.headers.get("origin") !== config.origin ||
        req.headers.get("x-csrf-token") !== account.csrf
      )
        return reply("Forbidden", 403);
      sessions.delete(cookie(req, sessionCookie)!);
      headers.append("Set-Cookie", setCookie(sessionCookie, "", 0));
      return reply("Signed out", 200);
    }
    if (req.method !== "GET") return reply("Method not allowed", 405);
    if (!config) return reply("Sign-in is unavailable", 503);
    prune(transactions);
    try {
      if (url.pathname === "/auth/login") {
        if (transactions.size >= 1000) return reply("Sign-in busy", 503);
        const doc = await discovery();
        if (transactions.size >= 1000) return reply("Sign-in busy", 503);
        const id = token();
        const previous = cookie(req, transactionCookie);
        if (previous) transactions.delete(previous);
        const transaction = {
          state: token(),
          nonce: token(),
          verifier: token(),
          expiresAt: Date.now() + 600_000,
        };
        transactions.set(id, transaction);
        const target = new URL(doc.authorization);
        target.search = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: config.origin + "/auth/callback",
          response_type: "code",
          scope: "openid profile",
          state: transaction.state,
          nonce: transaction.nonce,
          code_challenge_method: "S256",
          code_challenge: createHash("sha256")
            .update(transaction.verifier)
            .digest("base64url"),
        }).toString();
        headers.append("Set-Cookie", setCookie(transactionCookie, id, 600));
        return redirect(target.href);
      }
      const id = cookie(req, transactionCookie) ?? "";
      const transaction = transactions.get(id);
      transactions.delete(id);
      headers.append("Set-Cookie", setCookie(transactionCookie, "", 0));
      if (
        !transaction ||
        url.searchParams.getAll("state").length !== 1 ||
        url.searchParams.get("state") !== transaction.state ||
        url.searchParams.has("error") ||
        (url.searchParams.has("iss") &&
          url.searchParams.get("iss") !== config.issuer) ||
        url.searchParams.getAll("code").length !== 1 ||
        !url.searchParams.get("code")
      )
        return reply("Invalid sign-in transaction", 400);
      const doc = await discovery();
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code: url.searchParams.get("code")!,
        redirect_uri: config.origin + "/auth/callback",
        code_verifier: transaction.verifier,
      });
      if (config.secret) body.set("client_secret", config.secret);
      const response = await request(doc.token, { method: "POST", body });
      if (!response.ok) throw new Error("Token exchange failed");
      const tokens = tokenResponseSchema.parse(await readJson(response));
      const { payload } = await jwtVerify(tokens.id_token, doc.keys, {
        issuer: config.issuer,
        audience: config.clientId,
        algorithms: ["RS256", "PS256", "ES256"],
        requiredClaims: ["sub", "iat", "exp", "nonce"],
        maxTokenAge: "10m",
      });
      if (
        payload.nonce !== transaction.nonce ||
        !payload.sub ||
        payload.sub.length > 512 ||
        (payload.azp !== undefined && payload.azp !== config.clientId) ||
        (Array.isArray(payload.aud) &&
          payload.aud.length > 1 &&
          payload.azp !== config.clientId)
      )
        throw new Error("Invalid ID token");
      prune(sessions);
      if (sessions.size >= 1000) return reply("Sign-in busy", 503);
      const expiresAt = Math.min(Date.now() + 30 * 60_000, payload.exp! * 1000);
      const account = Object.freeze({
        subject: payload.sub,
        issuer: config.issuer,
        name:
          typeof payload.name === "string"
            ? payload.name.slice(0, 120)
            : "Signed-in player",
        owner:
          !!ownerSubject &&
          payload.sub === ownerSubject &&
          payload.iss === config.issuer,
        csrf: token(),
        expiresAt,
      });
      const old = cookie(req, sessionCookie);
      if (old) sessions.delete(old);
      const sessionId = token();
      sessions.set(sessionId, account);
      headers.append(
        "Set-Cookie",
        setCookie(
          sessionCookie,
          sessionId,
          Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
        ),
      );
      return redirect(config.origin + "/");
    } catch {
      return reply("Sign-in could not be verified. Please try again.", 400);
    }
  }
  return { session, handle };
}
