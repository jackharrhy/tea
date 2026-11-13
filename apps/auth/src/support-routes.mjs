import { readFileSync, statSync } from "node:fs";
import { page } from "./views.mjs";
import { escapeHtml as h, contentSecurityPolicy } from "./security.mjs";
import { createSupportStore } from "./support-store.mjs";
import { createSupportLogin } from "./support-login.mjs";
import { createSupportProvider } from "./support-provider.mjs";
import { supportProfile } from "./support-profile.mjs";

const fail = (status) =>
  Object.assign(new Error("Support unavailable"), { status });
const local = (value) =>
  ["127.0.0.1", "localhost"].includes(new URL(value).hostname);
const secure = (value) =>
  new URL(value).protocol === "https:" ||
  (process.env.NODE_ENV !== "production" && local(value));
export function createSupportRoutes({
  configFile,
  filename,
  origin,
  access,
  native,
  accountActions,
}) {
  if (!configFile) return null;
  if (statSync(configFile).mode & 0o077)
    throw Error("Support configuration must be private");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  if (!filename || filename === ":memory:")
    throw Error("Support requires persistent access storage");
  if (
    typeof config.actorSubject !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(config.actorSubject)
  )
    throw Error("Reviewed support actor required");
  if (
    !secure(config.issuer) ||
    !secure(origin) ||
    !config.clientId ||
    !config.clientSecret ||
    Object.keys(config.consumers || {}).join() !== "artbin"
  )
    throw Error("Invalid support configuration");
  const consumer = config.consumers.artbin;
  if (
    !secure(consumer.origin) ||
    consumer.callback !== consumer.origin + "/auth/support/callback" ||
    !consumer.projectId ||
    !consumer.organizationId ||
    !consumer.resourceClientId ||
    !consumer.resourceSecret ||
    !/^[A-Za-z0-9_-]{43,}$/.test(consumer.transportSecret || "")
  )
    throw Error("Invalid support consumer");
  const store = createSupportStore({
    filename,
    key: Buffer.from(config.encryptionKey, "base64url"),
  });
  const provider = createSupportProvider({
    ...config,
    callback: origin + "/support/callback",
  });
  async function nativeEligible(body) {
    if (
      config.enabled !== true ||
      body.actor !== config.actorSubject ||
      body.consumer !== "artbin" ||
      !access.isAdministrator(body.actor) ||
      access.blocked(body.target, consumer.projectId)
    )
      return false;
    const [actor, target, grants] = await Promise.all([
      accountActions.managedUser(body.actor),
      accountActions.managedUser(body.target),
      native.list(body.target),
    ]);
    return (
      actor.state === "USER_STATE_ACTIVE" &&
      target.state === "USER_STATE_ACTIVE" &&
      grants.some(
        (grant) =>
          grant.projectId === consumer.projectId &&
          grant.state === "USER_GRANT_STATE_ACTIVE" &&
          grant.roleKeys?.some((role) => ["admin", "member"].includes(role)),
      )
    );
  }
  async function preflight(actor, target) {
    try {
      if (!(await nativeEligible({ actor, target, consumer: "artbin" })))
        return "ineligible";
      return await supportProfile({
        consumer,
        clientId: config.clientId,
        target,
      });
    } catch {
      return "unavailable";
    }
  }
  const eligible = async (body) =>
    body.consumer === "artbin" &&
    (await preflight(body.actor, body.target)) === "ready";
  const login = createSupportLogin({
    store,
    provider,
    consumers: config.consumers,
    eligible,
    actorSubject: config.actorSubject,
  });
  let sweeping = false;
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      await login.sweep();
    } catch {
      console.error("support_cleanup_pending");
    } finally {
      sweeping = false;
    }
  };
  const timer = setInterval(sweep, 15000);
  timer.unref();
  void sweep();
  return {
    preflight,
    enabled: config.enabled === true,
    enabledFor: (subject) =>
      config.enabled === true && subject === config.actorSubject,
    async server(request, response, url) {
      if (
        !["/support/redeem", "/support/session", "/support/end"].includes(
          url.pathname,
        )
      )
        return false;
      response.setHeader("Cache-Control", "no-store");
      try {
        if (
          request.method !== "POST" ||
          request.headers["content-type"]?.split(";")[0] !== "application/json"
        )
          throw fail(400);
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 16384) throw fail(413);
        }
        let input;
        try {
          input = JSON.parse(body);
        } catch {
          throw fail(400);
        }
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw fail(400);
        if (config.enabled !== true && url.pathname === "/support/redeem")
          throw fail(403);
        const result = await login.server(
          url.pathname,
          input,
          request.headers.authorization,
        );
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
      } catch (error) {
        const status = [400, 401, 403, 409, 410, 413].includes(error.status)
          ? error.status
          : 502;
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "support_request_failed" }));
      }
      return true;
    },
    async browser({ request, url, form, context, redirect, send, setPolicy }) {
      if (
        config.enabled !== true &&
        (url.pathname.startsWith("/support/") ||
          url.pathname.endsWith("/support"))
      )
        throw fail(403);
      const start = url.pathname.match(
        /^\/manage\/people\/([A-Za-z0-9-]{1,200})\/support$/,
      );
      if (start) {
        if (!context.admin || context.user !== config.actorSubject)
          throw fail(403);
        setPolicy(contentSecurityPolicy([consumer.callback, config.issuer]));
        if (request.method === "GET") {
          const profile = await preflight(context.user, start[1]);
          if (profile === "ineligible") throw fail(403);
          const target = await accountActions.managedUser(start[1]);
          if (profile !== "ready") {
            const message =
              profile === "missing"
                ? "Needs first Artbin sign-in."
                : "Artbin availability could not be checked. Try again later.";
            send(
              page(
                "Support login",
                `<section class="narrow"><h1>Support login</h1><p>${message}</p><a href="/manage/people/${h(start[1])}">Back</a></section>`,
                context,
              ),
            );
            return true;
          }
          const actor = await accountActions.managedUser(context.user);
          send(
            page(
              "Artbin",
              `<section class="narrow"><h1>Artbin</h1><p>View as ${h(target.human?.profile?.displayName || target.userName)}.</p><p class="muted">You: ${h(actor.human?.profile?.displayName || actor.userName)} · Up to ten minutes. Your identity stays visible.</p><form method="post" class="form-stack"><input type="hidden" name="csrf" value="${h(context.csrf)}"><input type="hidden" name="consumer" value="artbin"><label>Reason<textarea name="reason" required minlength="3" maxlength="500"></textarea></label><button>Continue to Artbin</button></form><p><a href="/manage/people/${h(start[1])}">Back to person</a></p></section>`,
              context,
            ),
          );
          return true;
        }
        if (request.method !== "POST") throw fail(405);
        redirect(
          await login.start({
            actor: context.user,
            target: start[1],
            consumer: form.get("consumer"),
            reason: form.get("reason"),
          }),
        );
        return true;
      }
      if (!["/support/handoff", "/support/callback"].includes(url.pathname))
        return false;
      if (request.method !== "GET" || !context.admin) throw fail(403);
      const input = Object.fromEntries(url.searchParams);
      if (
        [...url.searchParams.keys()].some(
          (key) => url.searchParams.getAll(key).length !== 1,
        )
      )
        throw fail(400);
      redirect(
        url.pathname === "/support/handoff"
          ? await login.handoff(input, context.user)
          : await login.callback(input, context.user),
      );
      return true;
    },
    close() {
      clearInterval(timer);
      store.close();
    },
  };
}
