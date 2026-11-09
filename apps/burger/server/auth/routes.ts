import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  exchangeCode,
  fetchUserinfo,
  parseUserinfo,
  discoverProvider,
  verifyIdToken,
  revokeAccessToken,
} from "./oauth";
import {
  createSession,
  getSession,
  deleteSession,
  parseSessionCookie,
  getSessionCookie,
  getClearSessionCookie,
} from "./sessions";
import { upsertUserFromIdentity, getUserById } from "./users";
import {
  type AuthConfig,
  buildRedirectUri,
  buildScopes,
  BURGER_ORGANIZATION_ID,
} from "./config";

const OAUTH_COOKIE_NAME = "burger_oauth";

const oauthCookie = (
  payload: { verifier: string; state: string; nonce: string },
  secure: boolean,
): string => {
  const value = encodeURIComponent(JSON.stringify(payload));
  const secureFlag = secure ? "; Secure" : "";
  return `${OAUTH_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secureFlag}`;
};

const clearOauthCookie = (secure: boolean): string => {
  const secureFlag = secure ? "; Secure" : "";
  return `${OAUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
};

const parseOauthCookie = (
  cookieHeader: string | null | undefined,
): { verifier: string; state: string; nonce: string } | null => {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${OAUTH_COOKIE_NAME}=([^;]+)`),
  );
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]!));
  } catch {
    return null;
  }
};

const redirect = (location: string, extraSetCookie?: string): Response => {
  const headers = new Headers();
  headers.set("Location", location);
  if (extraSetCookie) headers.append("Set-Cookie", extraSetCookie);
  return new Response("", { status: 302, headers });
};

export const authRoutes = ({
  db,
  config,
}: {
  db: Database;
  config: AuthConfig;
}) =>
  new Elysia()
    .get("/auth/login", async () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      const state = crypto.randomUUID();
      const nonce = crypto.randomUUID();
      const provider = await discoverProvider(config.issuerUrl);

      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: buildRedirectUri(config),
        scope: buildScopes(config),
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });

      return redirect(
        `${provider.authorization_endpoint}?${params.toString()}`,
        oauthCookie({ verifier, state, nonce }, config.isProduction),
      );
    })

    .get("/auth/4orm/callback", async ({ query, headers }) => {
      const code = query.code as string | undefined;
      const state = query.state as string | undefined;
      const error = query.error as string | undefined;
      const oauth = parseOauthCookie(headers.cookie);
      const callbackError = (error: string) =>
        redirect(
          `/?error=${encodeURIComponent(error)}`,
          clearOauthCookie(config.isProduction),
        );

      // Authorization errors must be bound to the same browser transaction as
      // successful callbacks before their provider-supplied error is trusted.
      if (!oauth || !state) {
        return callbackError("missing_state");
      }
      if (oauth.state !== state) {
        return callbackError("state_mismatch");
      }
      if (error) {
        return callbackError(error);
      }

      if (!code) {
        return callbackError("missing_state");
      }

      let token;
      let provider;
      try {
        provider = await discoverProvider(config.issuerUrl);
        token = await exchangeCode({
          code,
          codeVerifier: oauth.verifier,
          redirectUri: buildRedirectUri(config),
          tokenUrl: provider.token_endpoint,
          clientId: config.clientId,
        });
      } catch {
        return callbackError("token_exchange_failed");
      }

      let verifiedSubject;
      try {
        verifiedSubject = await verifyIdToken({
          idToken: token.id_token,
          issuer: provider.issuer,
          clientId: config.clientId,
          nonce: oauth.nonce,
          jwksUri: provider.jwks_uri,
        });
      } catch {
        return callbackError("id_token_failed");
      }

      let info;
      try {
        info = await fetchUserinfo({
          accessToken: token.access_token,
          userinfoUrl: provider.userinfo_endpoint,
        });
      } catch {
        return callbackError("userinfo_failed");
      } finally {
        await revokeAccessToken({
          accessToken: token.access_token,
          revocationUrl: provider.revocation_endpoint,
          clientId: config.clientId,
        }).catch(() => undefined);
      }

      let identity;
      try {
        identity = parseUserinfo(
          info,
          config.projectId,
          BURGER_ORGANIZATION_ID,
          verifiedSubject,
        );
      } catch {
        return callbackError("userinfo_failed");
      }

      const user = upsertUserFromIdentity(db, identity);
      const sessionId = createSession(db, user.id);

      const responseHeaders = new Headers();
      responseHeaders.set("Location", "/");
      responseHeaders.append(
        "Set-Cookie",
        clearOauthCookie(config.isProduction),
      );
      responseHeaders.append(
        "Set-Cookie",
        getSessionCookie(sessionId, config.isProduction),
      );
      return new Response("", { status: 302, headers: responseHeaders });
    })

    .get("/auth/me", ({ headers, set }) => {
      const sessionId = parseSessionCookie(headers.cookie);
      if (!sessionId) {
        set.status = 401;
        return "";
      }
      const session = getSession(db, sessionId);
      if (!session) {
        set.status = 401;
        return "";
      }
      const user = getUserById(db, session.userId);
      if (!user) {
        set.status = 401;
        return "";
      }
      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
      };
    })

    .post("/auth/logout", ({ headers }) => {
      const sessionId = parseSessionCookie(headers.cookie);
      if (sessionId) deleteSession(db, sessionId);
      const responseHeaders = new Headers();
      responseHeaders.append(
        "Set-Cookie",
        getClearSessionCookie(config.isProduction),
      );
      return new Response("", { status: 204, headers: responseHeaders });
    });
