import {
  createIdentityClient,
  createLoginTransaction,
  validLoginTransaction,
  type LoginTransaction,
} from "@tea/identity";
import { createController } from "remix/router";

import { databaseContext } from "../../middleware/database.ts";
import { routes } from "../../routes.ts";
import {
  centralAuthConfig,
  createSteveSession,
  destroySteveSession,
  sessionCookie,
} from "./auth.ts";

const transactionCookie = "steve_oauth";

function cookie(value: string, maxAge: number): string {
  return `${transactionCookie}=${value}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function readTransaction(request: Request): LoginTransaction | null {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${transactionCookie}=`))
    ?.slice(transactionCookie.length + 1);
  if (!value || value.length > 4096) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export default createController(routes.auth, {
  actions: {
    async login() {
      const config = centralAuthConfig();
      if (!config) return new Response("Not found", { status: 404 });
      const transaction = createLoginTransaction();
      const location = await createIdentityClient(
        config.identity,
      ).authorizationUrl(
        transaction,
        `${config.origin}${routes.auth.callback.href()}`,
      );
      return new Response(null, {
        status: 303,
        headers: {
          Location: location,
          "Set-Cookie": cookie(
            Buffer.from(JSON.stringify(transaction)).toString("base64url"),
            600,
          ),
          "Cache-Control": "no-store",
        },
      });
    },
    async callback(context) {
      const config = centralAuthConfig();
      if (!config) return new Response("Not found", { status: 404 });
      const transaction = readTransaction(context.request);
      const state = context.url.searchParams.get("state");
      const code = context.url.searchParams.get("code");
      const response = new Response(null, {
        status: 303,
        headers: {
          Location: routes.steve.index.href(),
          "Cache-Control": "no-store",
        },
      });
      response.headers.append("Set-Cookie", cookie("", 0));
      if (!transaction || !validLoginTransaction(transaction, state) || !code)
        return new Response("Sign-in could not be completed", {
          status: 400,
          headers: response.headers,
        });
      try {
        const profile = await createIdentityClient(config.identity).exchange(
          code,
          transaction,
          `${config.origin}${routes.auth.callback.href()}`,
        );
        const admin =
          profile.subject === config.adminSubject && profile.roles.has("admin");
        const recipient =
          profile.subject === config.recipientSubject &&
          profile.roles.has("member");
        if (!admin && !recipient)
          return new Response("Steve access has not been assigned", {
            status: 403,
            headers: response.headers,
          });
        const token = await createSteveSession(
          context.get(databaseContext),
          profile.subject,
          profile.expiresAt,
        );
        response.headers.append("Set-Cookie", sessionCookie(token, 3600));
        return response;
      } catch (error) {
        const status =
          error &&
          typeof error === "object" &&
          "status" in error &&
          typeof error.status === "number"
            ? error.status
            : 503;
        return new Response("Sign-in could not be completed", {
          status,
          headers: response.headers,
        });
      }
    },
    async logout(context) {
      if (!centralAuthConfig())
        return new Response("Not found", { status: 404 });
      const origin = context.request.headers.get("origin");
      if (origin && origin !== new URL(context.request.url).origin)
        return new Response("Cross-origin logout is not allowed", {
          status: 403,
        });
      await destroySteveSession(context.get(databaseContext), context.request);
      return new Response(null, {
        status: 303,
        headers: {
          Location: routes.home.href(),
          "Set-Cookie": sessionCookie("", 0),
          "Cache-Control": "no-store",
        },
      });
    },
  },
});
