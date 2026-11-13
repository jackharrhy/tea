import {
  createIdentityClient,
  createLoginTransaction,
  loginTransactionCookieName,
  validLoginTransaction,
  type LoginTransaction,
} from "@harrhy/identity";
import { createCookie } from "remix/cookie";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import type { CentralAuthConfig } from "../../config.ts";
import { deterministicPaletteColor } from "../../data/color.ts";
import type { IdentityValue } from "../../middleware/auth.ts";
import { routes } from "../../routes.ts";

const transactionPrefix = "marky_oauth";

export function createCentralAuthController(auth: CentralAuthConfig) {
  const identity = createIdentityClient(auth.identity);
  const redirectUri = `${auth.baseUrl}${routes.auth.callback.href()}`;
  const transactionCookie = (state: string | null) => {
    const name = loginTransactionCookieName(transactionPrefix, state);
    return name
      ? createCookie(name, {
          secrets: [auth.sessionSecret],
          path: "/auth",
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          maxAge: 600,
        })
      : null;
  };
  return createController(routes.auth, {
    actions: {
      async signIn() {
        const transaction = createLoginTransaction();
        const cookie = transactionCookie(transaction.state)!;
        const url = await identity.authorizationUrl(transaction, redirectUri);
        return redirect(url, {
          headers: {
            "Set-Cookie": await cookie.serialize(JSON.stringify(transaction)),
          },
        });
      },
      async callback(context) {
        const url = new URL(context.request.url);
        const state = url.searchParams.get("state");
        const cookie = transactionCookie(state);
        const raw = await cookie?.parse(context.request.headers.get("Cookie"));
        let transaction: LoginTransaction | undefined;
        try {
          transaction = typeof raw === "string" ? JSON.parse(raw) : undefined;
        } catch {}
        const cleared = cookie
          ? await cookie.serialize("", { maxAge: 0 })
          : null;
        const code = url.searchParams.get("code");
        if (!transaction || !validLoginTransaction(transaction, state) || !code)
          return new Response("Sign-in could not be completed", {
            status: 400,
            headers: cleared ? { "Set-Cookie": cleared } : undefined,
          });
        try {
          const profile = await identity.exchange(
            code,
            transaction,
            redirectUri,
          );
          const saved: IdentityValue = {
            subject: profile.subject,
            name: profile.displayName,
            color: deterministicPaletteColor(profile.subject),
            expiresAt: Math.min(profile.expiresAt * 1000, Date.now() + 3600000),
          };
          context.session.set("identity", saved);
          context.session.regenerateId(true);
          return redirect(routes.home.href(), {
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
      signOut(context) {
        context.session.destroy();
        return redirect(routes.home.href());
      },
    },
  });
}
