const fail = (status, message) => Object.assign(new Error(message), { status });

export function createLoginRoutes({
  api,
  accountActions,
  authorizationActions,
  rateLimit,
  localReturnTo,
  newSession,
  sessions,
  cookie,
  cookieName,
}) {
  return {
    async login({
      request,
      url,
      form,
      session,
      login,
      redirect,
      headers,
      setSession,
    }) {
      if (request.method === "GET") {
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
      if (request.method !== "POST") throw fail(405, "Method not allowed.");
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
        throw fail(401, "Password verification was not completed.");
      const enrollmentTicket = session.enrollmentTicket;
      sessions.delete(session.id);
      const next = Object.assign(newSession(), {
        userId,
        sessionId: result.sessionId,
        sessionToken: result.sessionToken,
        enrollmentTicket,
        authenticatedAt: Date.now(),
      });
      setSession(next);
      headers.set("Set-Cookie", cookie(next));
      redirect(localReturnTo(form.get("returnTo")));
    },
    async logout({ request, session, headers, redirect }) {
      if (request.method !== "POST") throw fail(405, "Method not allowed.");
      if (session.sessionId)
        await api(`/v2/sessions/${encodeURIComponent(session.sessionId)}`, {
          method: "DELETE",
          body: { sessionToken: session.sessionToken },
        });
      sessions.delete(session.id);
      headers.set(
        "Set-Cookie",
        `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
      );
      redirect("/login");
    },
  };
}
