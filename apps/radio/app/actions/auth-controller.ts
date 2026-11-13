import {
  createIdentityClient,
  createLoginTransaction,
  loginTransactionCookieName,
  validLoginTransaction,
  type LoginTransaction,
} from "@harrhy/identity";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { Session } from "remix/session";

import { AccessConfig } from "../middleware/access.ts";
import { RadioSessionCookie } from "../middleware/session-cookie.ts";
import { routes } from "../routes.ts";

const transactionPrefix = "radio_oauth";

function transactionCookie(
  config: { sessionSecret: string; secureCookies: boolean },
  state: string | null,
) {
  const name = loginTransactionCookieName(transactionPrefix, state);
  return name
    ? new RadioSessionCookie(name, config.sessionSecret, {
        path: "/auth",
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: "Lax",
        maxAge: 600,
      })
    : null;
}

export default createController(routes.auth, {
  actions: {
    async login(context) {
      const config = context.get(AccessConfig)!;
      const transaction = createLoginTransaction();
      const cookie = transactionCookie(config, transaction.state)!;
      const url = await createIdentityClient(config.identity).authorizationUrl(
        transaction,
        `${config.publicOrigin}${routes.auth.callback.href()}`,
      );
      return redirect(url, {
        headers: {
          "Set-Cookie": await cookie.serialize(JSON.stringify(transaction)),
        },
      });
    },
    async callback(context) {
      const config = context.get(AccessConfig)!;
      const session = context.get(Session)!;
      const url = new URL(context.request.url);
      const state = url.searchParams.get("state");
      const cookie = transactionCookie(config, state);
      const raw = await cookie?.parse(context.request.headers.get("Cookie"));
      let transaction: LoginTransaction | undefined;
      try {
        transaction = typeof raw === "string" ? JSON.parse(raw) : undefined;
      } catch {}
      const cleared = cookie ? await cookie.serialize("", { maxAge: 0 }) : null;
      const code = url.searchParams.get("code");
      if (!transaction || !validLoginTransaction(transaction, state) || !code)
        return new Response("Sign-in could not be completed", {
          status: 400,
          headers: cleared ? { "Set-Cookie": cleared } : undefined,
        });
      try {
        const profile = await createIdentityClient(config.identity).exchange(
          code,
          transaction,
          `${config.publicOrigin}${routes.auth.callback.href()}`,
        );
        session.regenerateId(true);
        session.set("authenticated", true);
        session.set("subject", profile.subject);
        session.set("name", profile.displayName.slice(0, 40));
        session.set("authenticatedAt", Date.now());
        session.set(
          "expiresAt",
          Math.min(profile.expiresAt * 1000, Date.now() + 3600000),
        );
        return redirect(routes.home.href(), {
          status: 303,
          headers: { "Set-Cookie": cleared! },
        });
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
          headers: { "Set-Cookie": cleared! },
        });
      }
    },
  },
});
