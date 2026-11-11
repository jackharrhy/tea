import { randomBytes } from "node:crypto";
import { createController } from "remix/router";
import { routes } from "../../routes.js";
import type { Transaction } from "../../identity.js";
import type { PortalConfig } from "../../router.js";

const random = () => randomBytes(32).toString("base64url");
const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { Location: location } });
async function checkMutation(
  request: Request,
  origin: string,
  expected: unknown,
): Promise<Response | null> {
  if (
    request.headers.get("Origin") !== origin ||
    typeof expected !== "string" ||
    !expected
  )
    return new Response("Forbidden", { status: 403 });
  if (
    request.headers.get("Content-Type")?.split(";")[0] !==
    "application/x-www-form-urlencoded"
  )
    return new Response("Unsupported form", { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return new Response("Forbidden", { status: 403 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return new Response("Form too large", { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get(
    "csrf",
  ) === expected
    ? null
    : new Response("Forbidden", { status: 403 });
}

export function createAuthController(config: PortalConfig) {
  return createController(routes.auth, {
    actions: {
      login: async (context) => {
        const rejected = await checkMutation(
          context.request,
          config.origin,
          context.session.get("csrf"),
        );
        if (rejected) return rejected;
        const tx: Transaction = {
          state: random(),
          nonce: random(),
          verifier: random(),
          createdAt: Date.now(),
          silent: false,
        };
        context.session.set("transaction", tx);
        context.session.set("probeDone", true);
        return redirect(await config.identity.begin(tx, false));
      },
      callback: async (context) => {
        const s = context.session;
        const url = new URL(routes.auth.callback.href(), config.origin);
        url.search = new URL(context.request.url).search;
        const tx = s.get("transaction") as Transaction | undefined;
        if (
          !tx ||
          typeof tx.state !== "string" ||
          tx.createdAt > Date.now() ||
          Date.now() - tx.createdAt > 600000 ||
          url.searchParams.get("state") !== tx.state
        )
          return new Response(
            "Invalid or expired sign-in. Return to rotund.org and try again.",
            { status: 400 },
          );
        s.unset("transaction");
        s.set("probeDone", true);
        const error = url.searchParams.get("error");
        if (error) {
          if (
            !(
              tx.silent &&
              [
                "login_required",
                "interaction_required",
                "consent_required",
                "account_selection_required",
              ].includes(error)
            )
          )
            s.set("error", "Sign-in was not completed. Please try again.");
          return redirect(routes.home.href());
        }
        try {
          const login = await config.identity.exchange(url, tx);
          if (
            !login.subject ||
            !login.accessToken ||
            login.expiresAt <= Date.now()
          )
            throw new Error("Invalid login");
          s.regenerateId(true);
          s.set("login", login);
          s.set("csrf", random());
          return redirect(routes.home.href());
        } catch {
          s.set("error", "Couldn’t complete sign-in. Please try again.");
          return redirect(routes.home.href());
        }
      },
      logout: async (context) => {
        const rejected = await checkMutation(
          context.request,
          config.origin,
          context.session.get("csrf"),
        );
        if (rejected) return rejected;
        context.session.destroy();
        return redirect("/?signed_out=1");
      },
    },
  });
}
