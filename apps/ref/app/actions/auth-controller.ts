import {
  createIdentityClient,
  createLoginTransaction,
  loginTransactionCookieName,
  validLoginTransaction,
  type LoginTransaction,
} from "@harrhy/identity";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import { AppIdentity, AppRuntime } from "../data/runtime.ts";
import { sessionCookie } from "../middleware/session.ts";
import { routes } from "../routes.ts";

const transactionPrefix = "ref_oauth";

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function readTransaction(
  request: Request,
  name: string | null,
): LoginTransaction | null {
  if (!name) return null;
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!value || value.length > 4096) return null;
  try {
    return JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export default createController(routes.auth, {
  actions: {
    async login(context) {
      const central = context.get(AppIdentity);
      if (!central) return new Response("Not found", { status: 404 });
      const transaction = createLoginTransaction();
      const name = loginTransactionCookieName(
        transactionPrefix,
        transaction.state,
      )!;
      const url = await createIdentityClient(central.config).authorizationUrl(
        transaction,
        `${central.origin}${routes.auth.callback.href()}`,
      );
      const encoded = btoa(JSON.stringify(transaction))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      return redirect(url, {
        status: 303,
        headers: { "Set-Cookie": cookie(name, encoded, 600) },
      });
    },
    async callback(context) {
      const central = context.get(AppIdentity);
      if (!central) return new Response("Not found", { status: 404 });
      const url = new URL(context.request.url);
      const state = url.searchParams.get("state");
      const name = loginTransactionCookieName(transactionPrefix, state);
      const transaction = readTransaction(context.request, name);
      const code = url.searchParams.get("code");
      const cleared = name ? cookie(name, "", 0) : null;
      if (!transaction || !validLoginTransaction(transaction, state) || !code)
        return new Response("Sign-in could not be completed", {
          status: 400,
          headers: cleared ? { "Set-Cookie": cleared } : undefined,
        });
      let stage = "exchange";
      try {
        const profile = await createIdentityClient(central.config).exchange(
          code,
          transaction,
          `${central.origin}${routes.auth.callback.href()}`,
        );
        stage = "session";
        const token = await context
          .get(AppRuntime)!
          .directory.createCentralSession(profile.subject, profile.expiresAt);
        const response = redirect(routes.home.href(), {
          status: 303,
          headers: { "Set-Cookie": cleared! },
        });
        response.headers.append(
          "Set-Cookie",
          sessionCookie(token, context.request, 3600, true),
        );
        return response;
      } catch (error) {
        const status =
          error &&
          typeof error === "object" &&
          "status" in error &&
          typeof error.status === "number"
            ? error.status
            : 503;
        console.error(
          JSON.stringify({
            event: "auth_callback_failed",
            stage,
            status,
            type: error instanceof Error ? error.name : "Unknown",
          }),
        );
        return new Response("Sign-in could not be completed", {
          status,
          headers: { "Set-Cookie": cleared! },
        });
      }
    },
  },
});
