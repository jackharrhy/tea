const fail = (status, message) => Object.assign(new Error(message), { status });

export function createOAuthBrowserRoutes({
  api,
  authorizationActions,
  assertApplication,
  grants,
  accessStore,
  contentSecurityPolicy,
  randomToken,
  renderAuthorization,
  renderDevice,
  renderDeviceCode,
  renderDeviceResult,
}) {
  return {
    async authorize({
      request,
      url,
      form,
      session,
      context,
      headers,
      send,
      redirect,
    }) {
      if (!["GET", "POST"].includes(request.method))
        throw fail(405, "Method not allowed.");
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
          headers.set(
            "Content-Security-Policy",
            contentSecurityPolicy(intent.request.redirectUri, {
              styleNonce: nonce,
            }),
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
    },
    async device({ request, url, form, session, context, sendRemix }) {
      if (request.method === "GET") {
        const code = url.searchParams.get("user_code");
        if (!code) {
          await sendRemix((nonce) => renderDeviceCode(context, nonce));
          return;
        }
        if (!/^[A-Z0-9-]{4,30}$/.test(code))
          throw fail(400, "Invalid device code.");
        const deviceRequest = (
          await api(`/v2/oidc/device_authorization/${encodeURIComponent(code)}`)
        ).deviceAuthorizationRequest;
        assertApplication(deviceRequest);
        await sendRemix((nonce) =>
          renderDevice(deviceRequest, code, context, nonce),
        );
        return;
      }
      if (request.method !== "POST") throw fail(405, "Method not allowed.");
      const code = form.get("userCode");
      if (!/^[A-Z0-9-]{4,30}$/.test(code || ""))
        throw fail(400, "Load the device request again.");
      const approve = form.get("decision") === "approve";
      session.deviceDecisions ||= new Map();
      let decision = session.deviceDecisions.get(code);
      if (decision?.expires < Date.now()) {
        session.deviceDecisions.delete(code);
        decision = undefined;
      }
      if (decision && decision.approve !== approve)
        throw fail(409, "This request has already been handled.");
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
            throw fail(403, `You do not have access to ${application.name}.`);
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
    },
  };
}
