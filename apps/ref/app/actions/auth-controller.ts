import {
  createIdentityClient,
  createLoginTransaction,
  validLoginTransaction,
  type LoginTransaction,
} from "@tea/identity";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import { AppIdentity, AppRuntime } from "../data/runtime.ts";
import { sessionCookie } from "../middleware/session.ts";
import { routes } from "../routes.ts";

const transactionCookie = "ref_oauth";

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
        headers: { "Set-Cookie": cookie(encoded, 600) },
      });
    },
    async callback(context) {
      const central = context.get(AppIdentity);
      if (!central) return new Response("Not found", { status: 404 });
      const transaction = readTransaction(context.request);
      const url = new URL(context.request.url);
      const code = url.searchParams.get("code");
      const cleared = cookie("", 0);
      if (
        !transaction ||
        !validLoginTransaction(transaction, url.searchParams.get("state")) ||
        !code
      )
        return new Response("Sign-in could not be completed", {
          status: 400,
          headers: { "Set-Cookie": cleared },
        });
      try {
        const profile = await createIdentityClient(central.config).exchange(
          code,
          transaction,
          `${central.origin}${routes.auth.callback.href()}`,
        );
        const token = await context
          .get(AppRuntime)!
          .directory.createCentralSession(profile.subject, profile.expiresAt);
        const response = redirect(routes.home.href(), {
          status: 303,
          headers: { "Set-Cookie": cleared },
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
        return new Response("Sign-in could not be completed", {
          status,
          headers: { "Set-Cookie": cleared },
        });
      }
    },
  },
});
