import { createServer } from "node:http";
import "remix/node-tsx";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createSupportRoutes } from "./support-routes.mjs";
import { createNativeAccess } from "./native-access.mjs";
import { createAccessStore } from "./access-store.mjs";
import { createAccessRoutes } from "./access-routes.mjs";
import { createZitadel } from "./zitadel.mjs";
import {
  randomToken,
  localReturnTo,
  validPost,
  contentSecurityPolicy,
  equalToken,
  escapeHtml as h,
} from "./security.mjs";
import * as views from "./views.mjs";
const { renderLogin } = await import("./login-page.tsx");
const { renderAuthorization } = await import("./authorization-page.tsx");
const { renderEmailForm, renderEmailResult } = await import("./email-page.tsx");
const { renderAccount } = await import("./account-page.tsx");
const {
  renderEnrollment,
  renderDevice,
  renderDeviceResult,
  renderDeviceCode,
} = await import("./flow-page.tsx");
const { renderDirectory, renderAppDetail } = await import("./directory-page.tsx");
const { renderSessions, renderPeople, renderNewPerson } = await import("./simple-access-pages.tsx");
const { renderServiceList, renderServiceDetail, renderIntegrations } = await import("./service-pages.tsx");
const { renderPreviewAccount, renderInactivePreview, renderActivity, renderOperation } = await import("./activity-pages.tsx");
const { renderGroups, renderGroupForm } = await import("./group-pages.tsx");
const { renderAccessForm, renderChangePreview } = await import("./access-pages.tsx");
import { createEmailActions } from "./email.mjs";
import { applicationForClient, searchAll } from "./applications.mjs";
import { createAccountActions } from "./accounts.mjs";
import { createEnrollmentActions } from "./enrollment.mjs";
import { createEnrollmentCompletion } from "./enrollment-completion.mjs";
import { createRadioEnrollment } from "./radio-enrollment.mjs";
import { createAuthorizationActions } from "./authorization.mjs";
import { authorizationPolicy, isAuthorizationPath } from "./oidc-policy.mjs";

const origin = process.env.PUBLIC_ORIGIN || "https://auth.jackharrhy.dev";
const organizationId = process.env.ORGANIZATION_ID;
const projectId = process.env.LORE_PROJECT_ID;
const clientId = process.env.LORE_CLIENT_ID;

if (!organizationId || !projectId || !clientId)
  throw new Error("Missing identity configuration");
const api = createZitadel({
  baseUrl: process.env.ZITADEL_API_URL || origin,
  loginTokenFile:
    process.env.LOGIN_TOKEN_FILE || "/run/secrets/login-token.json",
  managementTokenFile:
    process.env.MANAGEMENT_TOKEN_FILE || "/run/secrets/management-token.json",
  organizationId,
});
const emailActions = createEmailActions(api, origin);
const accountActions = createAccountActions(api, organizationId);
const applications = JSON.parse(
  readFileSync(
    process.env.AUTH_APPLICATIONS_FILE ||
      new URL("../config/applications.json", import.meta.url),
    "utf8",
  ),
);
const services = JSON.parse(
  readFileSync(
    process.env.AUTH_SERVICES_FILE ||
      new URL("../config/services.json", import.meta.url),
    "utf8",
  ),
);
const integrations = JSON.parse(
  readFileSync(
    process.env.AUTH_INTEGRATIONS_FILE ||
      new URL("../config/integrations.json", import.meta.url),
    "utf8",
  ),
);
const nativeAccess = createNativeAccess(api, organizationId);
const accessFilename =
  process.env.ACCESS_DB_FILE ||
  (process.env.RADIO_ENROLLMENT_DB_FILE
    ? join(dirname(process.env.RADIO_ENROLLMENT_DB_FILE), "access.sqlite")
    : ":memory:");
let radioEnrollment;
const accessStore = createAccessStore({
  filename: accessFilename,
  applications,
  services,
  native: nativeAccess,
  onIssued: async ({ after }) => {
    const radio = applications.find((app) => app.id === "radio");
    if (after.projectId !== radio?.projectId || !radioEnrollment) return;
    if (after.roleKeys.some((role) => ["member", "admin"].includes(role)))
      await radioEnrollment.approve(radio, after.userId);
    else radioEnrollment.deny(radio, after.userId);
  },
});
const accessRoutes = createAccessRoutes({
  api,
  applications,
  services,
  integrations,
  access: accessStore,
  native: nativeAccess,
  organizationId,
  accountActions,
  endUserSessions,
  rateLimit,
  supportPreflight: (actor, target) => supportRoutes?.preflight(actor, target),
  renderDirectory,
  renderAppDetail,
  renderSessions,
  renderPeople,
  renderNewPerson,
  renderServiceList,
  renderServiceDetail,
  renderIntegrations,
  renderPreviewAccount,
  renderInactivePreview,
  renderActivity,
  renderOperation,
  renderGroups,
  renderGroupForm,
  renderAccessForm,
  renderChangePreview,
});
radioEnrollment = process.env.RADIO_ENROLLMENT_DB_FILE
  ? createRadioEnrollment({
      filename: process.env.RADIO_ENROLLMENT_DB_FILE,
      api,
      organizationId,
      isBlocked: (subject) =>
        accessStore.blocked(
          subject,
          applications.find((app) => app.id === "radio")?.projectId,
        ),
    })
  : null;
const supportRoutes = createSupportRoutes({
  configFile: process.env.AUTH_SUPPORT_CONFIG_FILE,
  filename: accessFilename,
  origin,
  access: accessStore,
  native: nativeAccess,
  accountActions,
});
const authorizationActions = createAuthorizationActions({
  api,
  applications,
  grants,
  organizationId,
  radioEnrollment,
  isBlocked: (subject, project) => accessStore.blocked(subject, project),
});
const enrollmentKey = process.env.FOURM_ENROLLMENT_KEY_FILE
  ? JSON.parse(readFileSync(process.env.FOURM_ENROLLMENT_KEY_FILE, "utf8"))
      .token
  : null;
const enrollmentApplication = applications.find((app) => app.id === "fourm");
const enrollment = enrollmentKey
  ? createEnrollmentActions({
      api,
      application: enrollmentApplication,
      key: enrollmentKey,
      origin,
    })
  : null;
const enrollmentCompletion =
  enrollmentKey && enrollmentApplication.enrollment.companionApplications
    ? createEnrollmentCompletion({
        api,
        application: enrollmentApplication,
        applications,
        organizationId,
        key: enrollmentKey,
        isBlocked: (subject, project) => accessStore.blocked(subject, project),
      })
    : null;
const css = readFileSync(new URL("./styles.css", import.meta.url));
const doodleAssets = new Map([
  [
    "/assets/doodle-motion.mjs",
    readFileSync(new URL("../public/doodle-motion.mjs", import.meta.url)),
  ],
  [
    "/assets/doodle-webgl.mjs",
    readFileSync(new URL("../public/doodle-webgl.mjs", import.meta.url)),
  ],
  [
    "/assets/doodle-spec.mjs",
    readFileSync(new URL("./doodles.mjs", import.meta.url)),
  ],
]);
const inter = readFileSync(
  new URL("../public/fonts/inter-variable.woff2", import.meta.url),
);
const sessions = new Map(),
  attempts = new Map();
const cookieName = "__Host-jack_auth";
const sessionLifetime = 30 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of sessions)
    if (value.expires < now) sessions.delete(key);
  for (const [key, value] of attempts)
    if (value.expires < now) attempts.delete(key);
}, 60_000).unref();

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
function newSession() {
  if (sessions.size >= 10_000) sessions.delete(sessions.keys().next().value);
  const session = {
    id: randomToken(),
    csrf: randomToken(),
    expires: Date.now() + sessionLifetime,
  };
  sessions.set(session.id, session);
  return session;
}
function cookie(session) {
  return `${cookieName}=${session.id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetime / 1000}`;
}
function rateLimit(key, limit = 15) {
  if (attempts.size >= 10_000 && !attempts.has(key))
    throw httpError(429, "Please try again later.");
  const record = attempts.get(key) || {
    count: 0,
    expires: Date.now() + 300_000,
  };
  if (record.expires < Date.now()) {
    record.count = 0;
    record.expires = Date.now() + 300_000;
  }
  record.count++;
  attempts.set(key, record);
  if (record.count > limit)
    throw httpError(
      429,
      "Too many attempts. Please try again in five minutes.",
    );
}
async function formData(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > 16_384)
      throw httpError(413, "Request is too large.");
  }
  return new URLSearchParams(body);
}
async function grants(application) {
  return searchAll(
    api,
    "/management/v1/users/grants/_search",
    application
      ? [{ projectIdQuery: { projectId: application.projectId } }]
      : [],
  );
}
function assertApplication(request) {
  return applicationForClient(applications, request.clientId);
}
async function endUserSessions(userId) {
  const current = await nativeAccess.sessions(userId);
  for (const value of current) {
    try {
      await nativeAccess.endSession(userId, value.id);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  for (const [id, value] of sessions)
    if (value.userId === userId) sessions.delete(id);
}

createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  // no-referrer would make browsers send Origin: null on HTML form POSTs.
  response.setHeader("Referrer-Policy", "same-origin");
  const url = new URL(request.url, origin);
  response.setHeader(
    "Content-Security-Policy",
    contentSecurityPolicy(undefined, { scripts: url.pathname === "/login" }),
  );
  const send = (html, status = 200) => {
    response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  };
  const redirect = (path) => {
    response.writeHead(303, { Location: path });
    response.end();
  };
  const sendRemix = async (render, status = 200) => {
    const nonce = randomToken();
    response.setHeader(
      "Content-Security-Policy",
      contentSecurityPolicy(undefined, { styleNonce: nonce }),
    );
    send(await render(nonce), status);
  };
  const login = async (returnTo, csrf, error, status = error ? 401 : 200) => {
    returnTo = localReturnTo(returnTo);
    const destination = new URL(returnTo, origin);
    const id =
      destination.pathname === "/authorize" &&
      destination.searchParams.get("authRequest");
    let callbackOrigin;
    if (id) {
      const { request: authRequest, callback } =
        await authorizationActions.begin(id, session);
      if (callback) {
        redirect(callback);
        return;
      }
      callbackOrigin = authRequest.redirectUri;
    }
    const nonce = randomToken();
    response.setHeader(
      "Content-Security-Policy",
      contentSecurityPolicy(callbackOrigin, { scripts: true, styleNonce: nonce }),
    );
    send(await renderLogin({ csrf, returnTo, error }, nonce), status);
  };
  let session;
  try {
    if (supportRoutes && (await supportRoutes.server(request, response, url)))
      return;
    if (url.pathname === "/enroll/complete") {
      try {
        if (request.method !== "POST")
          throw httpError(405, "POST is required.");
        if (!enrollmentCompletion)
          throw httpError(503, "Enrollment completion is unavailable.");
        if (
          !equalToken(request.headers.authorization, `Bearer ${enrollmentKey}`)
        )
          throw httpError(401, "Enrollment service authentication required.");
        if (
          request.headers["content-type"]?.split(";")[0].trim() !==
          "application/json"
        )
          throw httpError(415, "JSON is required.");
        let body = "";
        for await (const chunk of request) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 4096)
            throw httpError(413, "Request is too large.");
        }
        let input;
        try {
          input = JSON.parse(body);
        } catch {
          throw httpError(400, "Invalid JSON.");
        }
        const result = await enrollmentCompletion.complete(input);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(result));
      } catch (error) {
        const status =
          Number.isInteger(error.status) &&
          error.status >= 400 &&
          error.status < 600
            ? error.status
            : 502;
        response.writeHead(status, {
          "Content-Type": "application/json",
          ...(status === 405 ? { Allow: "POST" } : {}),
        });
        response.end(
          JSON.stringify({
            error:
              error.code === "enrollment_grant_ambiguous"
                ? error.code
                : "enrollment_completion_failed",
          }),
        );
      }
      return;
    }
    if (url.pathname === "/internal/oidc/authorize-policy") {
      const uri = request.headers["x-forwarded-uri"];
      const method = request.headers["x-forwarded-method"];
      let body = new URLSearchParams();
      let authorizationPath;
      try {
        authorizationPath = typeof uri === "string" && isAuthorizationPath(uri);
      } catch {
        throw httpError(400, "Invalid authorization request URI.");
      }
      if (authorizationPath && method === "POST") {
        if (
          !request.headers["content-type"]?.startsWith(
            "application/x-www-form-urlencoded",
          )
        )
          throw httpError(415, "Unsupported authorization form.");
        body = await formData(request);
      }
      const policy = authorizationPolicy(uri, method, body, applications);
      if (typeof uri === "string") {
        const client =
          new URL(uri, origin).searchParams.get("client_id") ||
          body.get("client_id");
        const minimum = applications
          .map((app) => app.authRequestNotBefore?.[client])
          .find(Boolean);
        if (minimum) response.setHeader("X-Jack-Auth-Not-Before", minimum);
      }
      response.writeHead(policy.allowed ? 200 : 400, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify(policy));
      return;
    }
    if (request.method === "GET" && url.pathname === "/healthz") {
      response.end("ok");
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/assets/fonts/inter-variable.woff2"
    ) {
      response.writeHead(200, {
        "Content-Type": "font/woff2",
        "Cache-Control": "public, max-age=86400",
      });
      response.end(inter);
      return;
    }
    if (request.method === "GET" && doodleAssets.has(url.pathname)) {
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
      });
      response.end(doodleAssets.get(url.pathname));
      return;
    }
    if (request.method === "GET" && url.pathname === "/assets/style.css") {
      response.writeHead(200, { "Content-Type": "text/css" });
      response.end(css);
      return;
    }
    const cookieValue = request.headers.cookie
      ?.split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    session = sessions.get(cookieValue);
    if (!session || session.expires < Date.now()) {
      session = newSession();
      response.setHeader("Set-Cookie", cookie(session));
    }
    let form;
    if (request.method === "POST") {
      if (
        !request.headers["content-type"]?.startsWith(
          "application/x-www-form-urlencoded",
        )
      )
        throw httpError(415, "Unsupported form type.");
      form = await formData(request);
      if (
        !validPost(
          request.headers.origin,
          origin,
          form.get("csrf"),
          session.csrf,
        )
      ) {
        console.warn(
          "form_rejected",
          JSON.stringify({
            originMatches: request.headers.origin === origin,
            hasCookie: Boolean(cookieValue),
            knownSession: Boolean(cookieValue && sessions.has(cookieValue)),
            csrfMatches: validPost(
              origin,
              origin,
              form.get("csrf"),
              session.csrf,
            ),
          }),
        );
        if (request.headers.origin === origin && url.pathname === "/login") {
          await login(
            localReturnTo(form.get("returnTo")),
            session.csrf,
            "This form expired. Try signing in again.",
            403,
          );
          return;
        }
        throw httpError(
          403,
          "This form expired. Open Sign in above to load a fresh form.",
        );
      }
    }
    const context = {
      user: session.userId,
      admin: accessStore.isAdministrator(session.userId),
      csrf: session.csrf,
      supportEnabled: supportRoutes?.enabledFor(session.userId) === true,
      enrollment: Boolean(session.enrollmentTicket),
    };
    if (
      request.method === "GET" &&
      ["/verify-email", "/reset-password"].includes(url.pathname)
    ) {
      const key =
        url.pathname === "/verify-email"
          ? "emailVerification"
          : "passwordRecovery";
      if (url.searchParams.has("code")) {
        const userId = url.searchParams.get("userID"),
          code = url.searchParams.get("code");
        if (
          !/^[A-Za-z0-9-]{1,200}$/.test(userId || "") ||
          !/^[A-Za-z0-9_-]{1,20}$/.test(code || "")
        )
          throw httpError(
            400,
            "This email link is invalid. Request a new one.",
          );
        session[key] = { userId, code };
        redirect(url.pathname);
        return;
      }
      if (!session[key])
        throw httpError(400, "Open the link in your email to continue.");
      const emailContext = {
        ...context,
        ...(key === "passwordRecovery"
          ? { passwordPolicy: await emailActions.passwordPolicy() }
          : {}),
      };
      await sendRemix((nonce) =>
        renderEmailForm(key === "emailVerification" ? "verify" : "reset", emailContext, nonce),
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/verify-email") {
      const pending = session.emailVerification;
      if (!pending) throw httpError(400, "Open the verification link again.");
      rateLimit(`verify:${pending.userId}`);
      try {
        await emailActions.verify(pending.userId, pending.code);
      } catch {
        throw httpError(
          400,
          "This verification link has expired or was already used. Request a new one from your account.",
        );
      }
      delete session.emailVerification;
      await sendRemix((nonce) =>
        renderEmailResult("Email verified", "Your email address is verified.", context, nonce),
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/forgot-password") {
      await sendRemix((nonce) => renderEmailForm("forgot", context, nonce));
      return;
    }
    if (request.method === "POST" && url.pathname === "/forgot-password") {
      rateLimit(`recovery:${form.get("username")?.trim().toLowerCase()}`);
      rateLimit("recovery-total", 100);
      await emailActions.requestReset(form.get("username"));
      await sendRemix((nonce) =>
        renderEmailResult(
          "Check your email",
          "If this account has a verified email address, we sent a recovery link.",
          context,
          nonce,
        ),
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/reset-password") {
      const pending = session.passwordRecovery;
      if (!pending) throw httpError(400, "Open the recovery link again.");
      rateLimit(`reset:${pending.userId}`);
      try {
        if (form.get("password") !== form.get("confirmation"))
          throw httpError(400, "The passwords do not match.");
        await emailActions.resetPassword(
          pending.userId,
          pending.code,
          form.get("password"),
        );
      } catch (error) {
        if (error.status !== 400) throw error;
        const resetContext = {
          ...context,
          passwordPolicy: await emailActions.passwordPolicy(),
          error:
            error.message === "Identity service rejected the request"
              ? "The password could not be saved. Check the requirements below, or request a new recovery link if this one has expired."
              : error.message,
        };
        await sendRemix((nonce) => renderEmailForm("reset", resetContext, nonce), 400);
        return;
      }
      delete session.passwordRecovery;
      await endUserSessions(pending.userId);
      await sendRemix((nonce) =>
        renderEmailResult("Password updated", "Sign in with your new password.", { csrf: session.csrf }, nonce),
      );
      return;
    }
    if (url.pathname === "/enroll") {
      if (!enrollment)
        throw httpError(
          503,
          "Registration is unavailable. Please try again later.",
        );
      if (request.method === "GET" && url.searchParams.has("ticket")) {
        await enrollment.pending(url.searchParams.get("ticket"));
        session.enrollmentTicket = url.searchParams.get("ticket");
        redirect("/enroll");
        return;
      }
      if (!session.enrollmentTicket)
        throw httpError(400, "Open your 4orm invite link again.");
      await enrollment.pending(session.enrollmentTicket);
      if (!session.userId && request.method === "GET") {
        await sendRemix((nonce) => renderEnrollment(context, undefined, nonce));
        return;
      }
      if (!session.userId && request.method === "POST") {
        rateLimit("enrollment-total", 30);
        if (form.get("password") !== form.get("confirmation"))
          throw httpError(400, "The passwords do not match.");
        const userId = await enrollment.createUser(
          session.enrollmentTicket,
          {
            username: form.get("username")?.trim(),
            email: form.get("email")?.trim(),
            password: form.get("password"),
          },
          organizationId,
        );
        const result = await api("/v2/sessions", {
          method: "POST",
          body: {
            checks: {
              user: { userId },
              password: { password: form.get("password") },
            },
            lifetime: "1800s",
          },
        });
        const verified = (
          await api(`/v2/sessions/${encodeURIComponent(result.sessionId)}`)
        ).session;
        if (
          verified?.factors?.user?.id !== userId ||
          !verified?.factors?.password?.verifiedAt
        )
          throw httpError(401, "Sign in to your account to continue.");
        const enrollmentTicket = session.enrollmentTicket;
        sessions.delete(session.id);
        session = Object.assign(newSession(), {
          userId,
          sessionId: result.sessionId,
          sessionToken: result.sessionToken,
          enrollmentTicket,
        });
        response.setHeader("Set-Cookie", cookie(session));
        redirect("/enroll");
        return;
      }
    }
    if (request.method === "GET" && url.pathname === "/login") {
      const authRequest = url.searchParams.get("authRequest");
      const returnTo = authRequest
        ? `/authorize?authRequest=${encodeURIComponent(authRequest)}`
        : localReturnTo(url.searchParams.get("returnTo"));
      if (session.userId && authRequest) {
        const { callback, requireLogin } = await authorizationActions.begin(
          authRequest,
          session,
        );
        if (callback) {
          redirect(callback);
          return;
        }
        if (!requireLogin) {
          redirect(returnTo);
          return;
        }
      }
      await login(returnTo, session.csrf);
      return;
    }
    if (request.method === "POST" && url.pathname === "/login") {
      rateLimit(`user:${form.get("username")?.trim().toLowerCase()}`);
      rateLimit("login-total", 300);
      let result;
      try {
        const userCheck = await accountActions.loginUser(form.get("username"));
        result = await api("/v2/sessions", {
          method: "POST",
          body: {
            checks: {
              user: userCheck,
              password: { password: form.get("password") },
            },
            lifetime: "1800s",
          },
        });
      } catch {
        await login(
          localReturnTo(form.get("returnTo")),
          session.csrf,
          "Sign-in failed. Check your username and password.",
        );
        return;
      }
      const verified = await api(
        `/v2/sessions/${encodeURIComponent(result.sessionId)}`,
      );
      const userId = verified.session?.factors?.user?.id;
      if (!userId || !verified.session?.factors?.password?.verifiedAt)
        throw httpError(401, "Password verification was not completed.");
      const enrollmentTicket = session.enrollmentTicket;
      sessions.delete(session.id);
      session = Object.assign(newSession(), {
        userId,
        sessionId: result.sessionId,
        sessionToken: result.sessionToken,
        enrollmentTicket,
        authenticatedAt: Date.now(),
      });
      response.setHeader("Set-Cookie", cookie(session));
      redirect(localReturnTo(form.get("returnTo")));
      return;
    }
    if (request.method === "POST" && url.pathname === "/logout") {
      if (session.sessionId)
        await api(`/v2/sessions/${encodeURIComponent(session.sessionId)}`, {
          method: "DELETE",
          body: { sessionToken: session.sessionToken },
        });
      sessions.delete(session.id);
      response.setHeader(
        "Set-Cookie",
        `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
      );
      redirect("/login");
      return;
    }
    if (!session.userId) {
      redirect(
        `/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`,
      );
      return;
    }
    let providerSession;
    try {
      providerSession = (
        await api(`/v2/sessions/${encodeURIComponent(session.sessionId)}`)
      ).session;
    } catch (error) {
      if (![401, 403, 404].includes(error.status)) throw error;
      sessions.delete(session.id);
      redirect(
        `/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`,
      );
      return;
    }
    if (
      providerSession?.factors?.user?.id !== session.userId ||
      !providerSession?.factors?.password?.verifiedAt ||
      !Number.isFinite(Date.parse(providerSession.expirationDate)) ||
      Date.parse(providerSession.expirationDate) <= Date.now()
    ) {
      sessions.delete(session.id);
      throw httpError(401, "Your session expired. Sign in again.");
    }
    const profile = (
      await api(`/management/v1/users/${encodeURIComponent(session.userId)}`, {
        management: true,
      })
    ).user;
    if (
      profile?.state !== "USER_STATE_ACTIVE" ||
      !profile.human ||
      profile.details?.resourceOwner !== organizationId
    ) {
      sessions.delete(session.id);
      throw httpError(403, "This account is not active.");
    }
    if (
      supportRoutes &&
      (await supportRoutes.browser({
        request,
        url,
        form,
        context,
        redirect,
        send,
        setPolicy: (value) =>
          response.setHeader("Content-Security-Policy", value),
      }))
    )
      return;
    if (
      await accessRoutes({
        request,
        url,
        form,
        session,
        profile,
        context,
        send,
        sendRemix,
        redirect,
      })
    )
      return;
    if (url.pathname === "/enroll" || url.pathname === "/enroll/continue") {
      if (!enrollment || !session.enrollmentTicket)
        throw httpError(400, "Open your 4orm invite link again.");
      if (request.method === "POST" && url.pathname === "/enroll/continue") {
        rateLimit(`enrollment:${session.userId}`);
        const destination = await enrollment.continue(
          session.enrollmentTicket,
          profile,
        );
        delete session.enrollmentTicket;
        redirect(destination);
        return;
      }
      if (request.method === "GET" && url.pathname === "/enroll") {
        await enrollment.pending(session.enrollmentTicket);
        await sendRemix((nonce) => renderEnrollment(context, profile, nonce));
        return;
      }
    }
    if (request.method === "POST" && url.pathname === "/account/email") {
      rateLimit(`email:${session.userId}`);
      await accountActions.provePassword(session, form.get("currentPassword"));
      await emailActions.setEmail(session.userId, form.get("email")?.trim());
      await sendRemix((nonce) =>
        renderEmailResult("Check your email", "Open the verification link to confirm your address.", context, nonce),
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/account/password") {
      rateLimit(`password-change:${session.userId}`);
      if (form.get("password") !== form.get("confirmation"))
        throw httpError(400, "The passwords do not match.");
      await accountActions.changePassword(
        session.userId,
        form.get("currentPassword"),
        form.get("password"),
      );
      await endUserSessions(session.userId);
      response.setHeader(
        "Set-Cookie",
        `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
      );
      await sendRemix((nonce) =>
        renderEmailResult("Password updated", "Sign in with your new password.", {}, nonce),
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/account/email/resend") {
      if (
        !profile.human?.email?.email ||
        profile.human.email.email.endsWith(".invalid") ||
        profile.human.email.isEmailVerified
      )
        throw httpError(
          400,
          "Add an unverified email address to your account first.",
        );
      rateLimit(`email:${session.userId}`);
      await emailActions.resend(session.userId);
      await sendRemix((nonce) =>
        renderEmailResult("Check your email", "We sent a new verification link.", context, nonce),
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/account") {
      await sendRemix((nonce) => renderAccount(profile, context, nonce));
      return;
    }
    if (
      url.pathname === "/authorize" &&
      ["GET", "POST"].includes(request.method)
    ) {
      const id =
        request.method === "GET"
          ? url.searchParams.get("authRequest")
          : form.get("authRequest");
      const { callback: silentCallback } = await authorizationActions.begin(
        id,
        session,
      );
      if (silentCallback) {
        redirect(silentCallback);
        return;
      }
      if (request.method === "GET") {
        const intent = await authorizationActions.view(id, session);
        if (intent.consent) {
          const nonce = randomToken();
          response.setHeader(
            "Content-Security-Policy",
            contentSecurityPolicy(intent.request.redirectUri, { styleNonce: nonce }),
          );
          send(await renderAuthorization(intent, id, context, nonce));
          return;
        }
      }
      const callback = await authorizationActions.complete(
        id,
        session,
        request.method === "POST" ? form.get("decision") : "approve",
        request.method === "GET",
      );
      redirect(callback);
      return;
    }
    if (request.method === "GET" && url.pathname === "/device") {
      const code = url.searchParams.get("user_code");
      if (!code) {
        await sendRemix((nonce) => renderDeviceCode(context, nonce));
        return;
      }
      if (!/^[A-Z0-9-]{4,30}$/.test(code))
        throw httpError(400, "Invalid device code.");
      const deviceRequest = (
        await api(`/v2/oidc/device_authorization/${encodeURIComponent(code)}`)
      ).deviceAuthorizationRequest;
      assertApplication(deviceRequest);
      await sendRemix((nonce) => renderDevice(deviceRequest, code, context, nonce));
      return;
    }
    if (request.method === "POST" && url.pathname === "/device") {
      const code = form.get("userCode");
      if (!/^[A-Z0-9-]{4,30}$/.test(code || ""))
        throw httpError(400, "Load the device request again.");
      const approve = form.get("decision") === "approve";
      session.deviceDecisions ||= new Map();
      let decision = session.deviceDecisions.get(code);
      if (decision?.expires < Date.now()) {
        session.deviceDecisions.delete(code);
        decision = undefined;
      }
      if (decision && decision.approve !== approve)
        throw httpError(409, "This request has already been handled.");
      if (!decision) {
        const pending = (async () => {
          const deviceRequest = (
            await api(
              `/v2/oidc/device_authorization/${encodeURIComponent(code)}`,
            )
          ).deviceAuthorizationRequest;
          const application = assertApplication(deviceRequest);
          if (
            approve &&
            (accessStore.blocked(session.userId, application.projectId) ||
              !(await grants(application)).some(
                (grant) =>
                  grant.userId === session.userId &&
                  grant.state === "USER_GRANT_STATE_ACTIVE",
              ))
          )
            throw httpError(
              403,
              `You do not have access to ${application.name}.`,
            );
          await api(
            `/v2/oidc/device_authorization/${encodeURIComponent(deviceRequest.id)}`,
            {
              method: "POST",
              body: approve
                ? {
                    session: {
                      sessionId: session.sessionId,
                      sessionToken: session.sessionToken,
                    },
                  }
                : { deny: {} },
            },
          );
        })();
        decision = { approve, pending, expires: Date.now() + 300_000 };
        if (session.deviceDecisions.size >= 8)
          session.deviceDecisions.delete(
            session.deviceDecisions.keys().next().value,
          );
        session.deviceDecisions.set(code, decision);
      }
      try {
        await decision.pending;
      } catch (error) {
        session.deviceDecisions.delete(code);
        throw error;
      }
      await sendRemix((nonce) => renderDeviceResult(approve, context, nonce));
      return;
    }
    throw httpError(404, "Page not found.");
  } catch (error) {
    const expected = error.status && error.status < 500;
    console.error(
      "request_failed",
      JSON.stringify({
        path: url.pathname,
        status: error.status || 500,
        code: error.code,
      }),
    );
    send(
      views.page(
        "Request failed",
        `<section class="narrow"><h1>Request failed</h1><p>${h(expected ? error.message : "The identity service could not complete this request. Please try again.")}</p><a href="${session?.enrollmentTicket ? "/enroll" : "/account"}">${session?.enrollmentTicket ? "Back to signup" : "Back to account"}</a></section>`,
      ),
      expected ? error.status : 502,
    );
  }
}).listen(
  Number(process.env.PORT || 3000),
  process.env.LISTEN_HOST || "0.0.0.0",
  () => console.info("auth listening"),
);
