const fail = (status, message) => Object.assign(new Error(message), { status });

export function createEnrollmentRoutes({
  enrollment,
  organizationId,
  api,
  rateLimit,
  sessions,
  newSession,
  cookie,
  renderEnrollment,
}) {
  return {
    async beforeAuth({
      request,
      url,
      form,
      session,
      context,
      headers,
      sendRemix,
      redirect,
      setSession,
    }) {
      if (!enrollment)
        throw fail(503, "Registration is unavailable. Please try again later.");
      if (request.method === "GET" && url.searchParams.has("ticket")) {
        await enrollment.pending(url.searchParams.get("ticket"));
        session.enrollmentTicket = url.searchParams.get("ticket");
        redirect("/enroll");
        return true;
      }
      if (!session.enrollmentTicket)
        throw fail(400, "Open your 4orm invite link again.");
      await enrollment.pending(session.enrollmentTicket);
      if (session.userId) return false;
      if (request.method === "GET") {
        await sendRemix((nonce) => renderEnrollment(context, undefined, nonce));
        return true;
      }
      if (request.method !== "POST") throw fail(405, "Method not allowed.");
      rateLimit("enrollment-total", 30);
      if (form.get("password") !== form.get("confirmation"))
        throw fail(400, "The passwords do not match.");
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
        throw fail(401, "Sign in to your account to continue.");
      const enrollmentTicket = session.enrollmentTicket;
      sessions.delete(session.id);
      const next = Object.assign(newSession(), {
        userId,
        sessionId: result.sessionId,
        sessionToken: result.sessionToken,
        enrollmentTicket,
      });
      setSession(next);
      headers.set("Set-Cookie", cookie(next));
      redirect("/enroll");
      return true;
    },
    async enroll({ request, session, profile, context, sendRemix }) {
      if (!enrollment || !session.enrollmentTicket)
        throw fail(400, "Open your 4orm invite link again.");
      if (request.method !== "GET") throw fail(404, "Page not found.");
      await enrollment.pending(session.enrollmentTicket);
      await sendRemix((nonce) => renderEnrollment(context, profile, nonce));
    },
    async continue({ request, session, profile, redirect }) {
      if (!enrollment || !session.enrollmentTicket)
        throw fail(400, "Open your 4orm invite link again.");
      if (request.method !== "POST") throw fail(404, "Page not found.");
      rateLimit(`enrollment:${session.userId}`);
      const destination = await enrollment.continue(
        session.enrollmentTicket,
        profile,
      );
      delete session.enrollmentTicket;
      redirect(destination);
    },
  };
}
