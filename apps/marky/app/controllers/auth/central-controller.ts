import {
  createIdentityClient,
  createLoginTransaction,
  validLoginTransaction,
  type LoginTransaction,
} from "@tea/identity";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import type { CentralAuthConfig } from "../../config.ts";
import { deterministicPaletteColor } from "../../data/color.ts";
import type { IdentityValue } from "../../middleware/auth.ts";
import { routes } from "../../routes.ts";

const transactionKey = "oauth.transaction";

export function createCentralAuthController(auth: CentralAuthConfig) {
  const identity = createIdentityClient(auth.identity);
  const redirectUri = `${auth.baseUrl}${routes.auth.callback.href()}`;
  return createController(routes.auth, {
    actions: {
      async signIn(context) {
        const transaction = createLoginTransaction();
        context.session.set(transactionKey, transaction);
        return redirect(
          await identity.authorizationUrl(transaction, redirectUri),
        );
      },
      async callback(context) {
        const transaction = context.session.get(transactionKey) as
          | LoginTransaction
          | undefined;
        context.session.unset(transactionKey);
        const url = new URL(context.request.url);
        const code = url.searchParams.get("code");
        if (
          !transaction ||
          !validLoginTransaction(transaction, url.searchParams.get("state")) ||
          !code
        )
          return new Response("Sign-in could not be completed", {
            status: 400,
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
          return redirect(routes.home.href());
        } catch (error) {
          const status =
            error &&
            typeof error === "object" &&
            "status" in error &&
            typeof error.status === "number"
              ? error.status
              : 503;
          return new Response("Sign-in could not be completed", { status });
        }
      },
      signOut(context) {
        context.session.destroy();
        return redirect(routes.home.href());
      },
    },
  });
}
