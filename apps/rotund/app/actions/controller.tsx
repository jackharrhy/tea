import { randomBytes } from "node:crypto";
import { createController } from "remix/router";
import { HomePage } from "./home-page.js";
import { routes } from "../routes.js";
import { visibleServices, type Service } from "../services.js";
import type { Login, Transaction } from "../identity.js";
import type { PortalConfig } from "../router.js";
import { addPendingTransaction } from "../pending-transactions.js";

const random = () => randomBytes(32).toString("base64url");
const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { Location: location } });
export function createHomeController(config: PortalConfig) {
  return createController(routes, {
    actions: {
      health: () => Response.json({ ok: true }),
      home: async (context) => {
        const s = context.session;
        if (!s.has("csrf")) s.set("csrf", random());
        const login = s.get("login") as Login | undefined;
        if (login && login.expiresAt <= Date.now()) {
          s.destroy();
          return redirect("/?session_expired=1");
        }
        if (
          !login &&
          !s.get("probeDone") &&
          !new URL(context.request.url).searchParams.has("signed_out") &&
          !new URL(context.request.url).searchParams.has("session_expired")
        ) {
          s.set("probeDone", true);
          const tx: Transaction = {
            state: random(),
            nonce: random(),
            verifier: random(),
            createdAt: Date.now(),
            silent: true,
          };
          addPendingTransaction(s, tx);
          return redirect(await config.identity.begin(tx, true));
        }
        s.set("probeDone", true);
        let items: Service[] = [];
        if (login) {
          try {
            const claims = await config.identity.userInfo(login);
            if (claims.sub !== login.subject)
              throw new Error("Identity subject mismatch");
            items = visibleServices(
              claims,
              config.bindings,
              config.organizationId,
            );
          } catch {
            return context.render(
              <HomePage
                {...{
                  csrf: String(s.get("csrf")),
                  signedIn: true,
                  items: [],
                  unavailable: true,
                }}
              />,
              { status: 503 },
            );
          }
        }
        const error = s.get("error");
        s.unset("error");
        return context.render(
          <HomePage
            {...{
              csrf: String(s.get("csrf")),
              signedIn: !!login,
              items,
              error: typeof error === "string" ? error : undefined,
            }}
          />,
        );
      },
    },
  });
}
