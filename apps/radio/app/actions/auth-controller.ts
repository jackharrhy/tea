import {
  createIdentityClient,
  createLoginTransaction,
  validLoginTransaction,
  type LoginTransaction,
} from "@tea/identity";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { Session } from "remix/session";

import { AccessConfig } from "../middleware/access.ts";
import { routes } from "../routes.ts";

const transactionKey = "oauth.transaction";

export default createController(routes.auth, {
  actions: {
    async login(context) {
      const config = context.get(AccessConfig)!;
      const transaction = createLoginTransaction();
      context.get(Session)!.set(transactionKey, transaction);
      return redirect(
        await createIdentityClient(config.identity).authorizationUrl(
          transaction,
          `${config.publicOrigin}${routes.auth.callback.href()}`,
        ),
      );
    },
    async callback(context) {
      const config = context.get(AccessConfig)!;
      const session = context.get(Session)!;
      const transaction = session.get(transactionKey) as
        | LoginTransaction
        | undefined;
      session.unset(transactionKey);
      const url = new URL(context.request.url);
      const code = url.searchParams.get("code");
      if (
        !transaction ||
        !validLoginTransaction(transaction, url.searchParams.get("state")) ||
        !code
      )
        return new Response("Sign-in could not be completed", { status: 400 });
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
        return redirect(routes.home.href(), 303);
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
  },
});
