import {
  authorizationForRequest,
  authorizationCallback,
} from "./applications.mjs";

const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const fingerprint = (request) =>
  JSON.stringify([
    request.clientId,
    request.redirectUri,
    [...(request.scope || [])].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
function requiresFreshLogin(request, session, now) {
  const prompts = Array.isArray(request.prompt) ? request.prompt : [];
  const force = prompts.includes("PROMPT_LOGIN");
  const maxAge = request.maxAge;
  if (!force && maxAge === undefined) return false;
  let ageMs;
  if (maxAge !== undefined) {
    const match =
      typeof maxAge === "string" && /^(\d+(?:\.\d+)?)s$/.exec(maxAge);
    if (!match || !Number.isFinite(Number(match[1]) * 1000))
      throw invalid("Invalid authentication age.");
    ageMs = Number(match[1]) * 1000;
  }
  const authenticatedAt = session.authenticatedAt;
  if (!Number.isFinite(authenticatedAt)) return true;
  if (force || ageMs === 0) {
    const createdAt = Date.parse(request.creationDate);
    if (!Number.isFinite(createdAt))
      throw invalid("Invalid authorization request.");
    if (authenticatedAt <= createdAt) return true;
  }
  return ageMs > 0 && now() - authenticatedAt > ageMs;
}
export function createAuthorizationActions({
  api,
  applications,
  grants,
  organizationId,
  radioEnrollment,
  isBlocked = () => false,
  now = Date.now,
}) {
  function decisions(session) {
    session.authorizations ||= new Map();
    for (const [id, item] of session.authorizations)
      if (item.expires <= now()) session.authorizations.delete(id);
    return session.authorizations;
  }
  async function prepare(id, session) {
    if (typeof id !== "string" || !id || id.length > 200)
      throw invalid("Invalid authorization request.");
    const request = (
      await api(`/v2/oidc/auth_requests/${encodeURIComponent(id)}`)
    ).authRequest;
    const intent = authorizationForRequest(applications, request);
    if (request.prompt?.includes("PROMPT_SELECT_ACCOUNT"))
      throw Object.assign(new Error("Account selection is unavailable."), {
        status: 403,
      });
    if (requiresFreshLogin(request, session, now))
      throw Object.assign(new Error("Sign in again to continue."), {
        status: 401,
      });
    if (isBlocked(session.userId, intent.application.projectId))
      throw Object.assign(
        new Error(
          "Access to this service is blocked. Contact your administrator.",
        ),
        { status: 403 },
      );
    if (intent.application.organizationHumansOnly === true) {
      const { user } = await api(
        `/management/v1/users/${encodeURIComponent(session.userId)}`,
        { management: true },
      );
      if (
        !organizationId ||
        user?.id !== session.userId ||
        user.state !== "USER_STATE_ACTIVE" ||
        !user.human ||
        user.machine ||
        user.details?.resourceOwner !== organizationId
      ) {
        throw Object.assign(
          new Error("An active account in this organization is required."),
          { status: 403 },
        );
      }
      return { ...intent, request };
    }
    if (
      intent.application.id === "radio" &&
      intent.application.selfEnrollment === "verified-organization-human"
    ) {
      if (!radioEnrollment)
        throw Object.assign(new Error("Radio enrollment is unavailable."), {
          status: 503,
        });
      if (!session.sessionId || !session.sessionToken)
        throw Object.assign(new Error("Sign in again before joining Radio."), {
          status: 403,
        });
      const { session: proof } = await api(
        `/v2/sessions/${encodeURIComponent(session.sessionId)}`,
      );
      if (
        proof?.factors?.user?.id !== session.userId ||
        !proof.factors.password?.verifiedAt ||
        Date.parse(proof.expirationDate) <= now() ||
        !Number.isFinite(Date.parse(proof.expirationDate))
      )
        throw Object.assign(new Error("Sign in again before joining Radio."), {
          status: 403,
        });
      const join = await radioEnrollment.inspect(
        intent.application,
        session.userId,
      );
      if (join)
        return {
          ...intent,
          request,
          consent: true,
          selfEnrollment: true,
          roles: ["member"],
          clientOrigin: new URL(request.redirectUri).origin,
        };
    }
    const grant = (await grants(intent.application)).find(
      (item) =>
        item.userId === session.userId &&
        item.state === "USER_GRANT_STATE_ACTIVE",
    );
    if (
      !grant ||
      intent.roles.some((role) => !grant.roleKeys?.includes(role)) ||
      (intent.anyRoles?.length &&
        !intent.anyRoles.some((role) => grant.roleKeys?.includes(role)))
    )
      throw Object.assign(
        new Error(
          `You do not have the required access to ${intent.application.name}.`,
        ),
        { status: 403 },
      );
    return { ...intent, request };
  }
  return {
    async begin(id, session) {
      if (typeof id !== "string" || !id || id.length > 200)
        throw invalid("Invalid authorization request.");
      const request = (
        await api(`/v2/oidc/auth_requests/${encodeURIComponent(id)}`)
      ).authRequest;
      authorizationForRequest(applications, request);
      if (request.prompt?.includes("PROMPT_SELECT_ACCOUNT")) {
        const result = await api(
          `/v2/oidc/auth_requests/${encodeURIComponent(id)}`,
          {
            method: "POST",
            body: {
              error: { error: "ERROR_REASON_ACCOUNT_SELECTION_REQUIRED" },
            },
          },
        );
        return {
          request,
          callback: authorizationCallback(
            request.redirectUri,
            result.callbackUrl,
          ),
        };
      }
      if (!request.prompt?.includes("PROMPT_NONE"))
        return {
          request,
          requireLogin: requiresFreshLogin(request, session, now),
        };
      let authenticated = false;
      if (session.userId && session.sessionId && session.sessionToken) {
        try {
          const { session: proof } = await api(
            `/v2/sessions/${encodeURIComponent(session.sessionId)}`,
          );
          if (
            proof?.factors?.user?.id === session.userId &&
            proof.factors.password?.verifiedAt &&
            Date.parse(proof.expirationDate) > now() &&
            !requiresFreshLogin(request, session, now)
          ) {
            const prepared = await prepare(id, session);
            authenticated = !prepared.consent;
          }
        } catch (error) {
          if (![401, 403, 404].includes(error.status)) throw error;
        }
      }
      const body = authenticated
        ? {
            session: {
              sessionId: session.sessionId,
              sessionToken: session.sessionToken,
            },
          }
        : { error: { error: "ERROR_REASON_LOGIN_REQUIRED" } };
      const result = await api(
        `/v2/oidc/auth_requests/${encodeURIComponent(id)}`,
        { method: "POST", body },
      );
      return {
        request,
        callback: authorizationCallback(
          request.redirectUri,
          result.callbackUrl,
        ),
      };
    },
    async view(id, session) {
      const intent = await prepare(id, session);
      if (intent.consent) {
        const stored = decisions(session);
        if (stored.size >= 8 && !stored.has(id))
          stored.delete(stored.keys().next().value);
        if (!stored.has(id))
          stored.set(id, {
            fingerprint: fingerprint(intent.request),
            expires: now() + 300_000,
          });
      }
      return intent;
    },
    async complete(id, session, decision, automatic = false) {
      if (!["approve", "deny"].includes(decision))
        throw invalid("Choose Allow or Deny.");
      const stored = decisions(session);
      const previous = stored.get(id);
      if (previous?.pending) {
        if (previous.decision !== decision)
          throw Object.assign(new Error("This request was already handled."), {
            status: 409,
          });
        return previous.pending;
      }
      const intent = await prepare(id, session);
      const current = stored.get(id);
      if (current?.pending) {
        if (current.decision !== decision)
          throw Object.assign(new Error("This request was already handled."), {
            status: 409,
          });
        return current.pending;
      }
      if (
        intent.consent &&
        (automatic ||
          !previous ||
          previous.fingerprint !== fingerprint(intent.request))
      )
        throw invalid("Load the authorization request again before deciding.");
      const pending = (async () => {
        if (decision === "approve" && intent.selfEnrollment)
          await radioEnrollment.join(intent.application, session.userId);
        const body =
          decision === "approve"
            ? {
                session: {
                  sessionId: session.sessionId,
                  sessionToken: session.sessionToken,
                },
              }
            : { error: { error: "ERROR_REASON_ACCESS_DENIED" } };
        const result = await api(
          `/v2/oidc/auth_requests/${encodeURIComponent(id)}`,
          { method: "POST", body },
        );
        return authorizationCallback(
          intent.request.redirectUri,
          result.callbackUrl,
        );
      })();
      if (stored.size >= 8 && !stored.has(id))
        stored.delete(stored.keys().next().value);
      stored.set(id, {
        fingerprint: fingerprint(intent.request),
        decision,
        pending,
        expires: now() + 300_000,
      });
      try {
        return await pending;
      } catch (error) {
        stored.delete(id);
        throw error;
      }
    },
  };
}
