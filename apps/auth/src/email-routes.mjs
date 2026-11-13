const fail = (status, message) => Object.assign(new Error(message), { status });
const userIdPattern = /^[A-Za-z0-9-]{1,200}$/;
const codePattern = /^[A-Za-z0-9_-]{1,20}$/;

export function createEmailRoutes({
  emailActions,
  endUserSessions,
  rateLimit,
  renderEmailForm,
  renderEmailResult,
}) {
  async function showLink({ url, session, context, redirect, sendRemix }, key) {
    if (url.searchParams.has("code")) {
      const userId = url.searchParams.get("userID");
      const code = url.searchParams.get("code");
      if (!userIdPattern.test(userId || "") || !codePattern.test(code || ""))
        throw fail(400, "This email link is invalid. Request a new one.");
      session[key] = { userId, code };
      redirect(url.pathname);
      return;
    }
    if (!session[key])
      throw fail(400, "Open the link in your email to continue.");
    const emailContext = {
      ...context,
      ...(key === "passwordRecovery"
        ? { passwordPolicy: await emailActions.passwordPolicy() }
        : {}),
    };
    await sendRemix((nonce) =>
      renderEmailForm(
        key === "emailVerification" ? "verify" : "reset",
        emailContext,
        nonce,
      ),
    );
  }

  return {
    async verifyEmail(input) {
      const { request, session, context, sendRemix } = input;
      if (request.method === "GET") {
        await showLink(input, "emailVerification");
        return;
      }
      if (request.method !== "POST") throw fail(405, "Method not allowed.");
      const pending = session.emailVerification;
      if (!pending) throw fail(400, "Open the verification link again.");
      rateLimit(`verify:${pending.userId}`);
      try {
        await emailActions.verify(pending.userId, pending.code);
      } catch {
        throw fail(
          400,
          "This verification link has expired or was already used. Request a new one from your account.",
        );
      }
      delete session.emailVerification;
      await sendRemix((nonce) =>
        renderEmailResult(
          "Email verified",
          "Your email address is verified.",
          context,
          nonce,
        ),
      );
    },
    async forgotPassword({ request, form, context, sendRemix }) {
      if (request.method === "GET") {
        await sendRemix((nonce) => renderEmailForm("forgot", context, nonce));
        return;
      }
      if (request.method !== "POST") throw fail(405, "Method not allowed.");
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
    },
    async resetPassword(input) {
      const { request, form, session, context, sendRemix } = input;
      if (request.method === "GET") {
        await showLink(input, "passwordRecovery");
        return;
      }
      if (request.method !== "POST") throw fail(405, "Method not allowed.");
      const pending = session.passwordRecovery;
      if (!pending) throw fail(400, "Open the recovery link again.");
      rateLimit(`reset:${pending.userId}`);
      try {
        if (form.get("password") !== form.get("confirmation"))
          throw fail(400, "The passwords do not match.");
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
        await sendRemix(
          (nonce) => renderEmailForm("reset", resetContext, nonce),
          400,
        );
        return;
      }
      delete session.passwordRecovery;
      await endUserSessions(pending.userId);
      await sendRemix((nonce) =>
        renderEmailResult(
          "Password updated",
          "Sign in with your new password.",
          { csrf: session.csrf },
          nonce,
        ),
      );
    },
  };
}
