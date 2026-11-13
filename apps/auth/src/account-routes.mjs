const fail = (status, message) => Object.assign(new Error(message), { status });

export function createAccountRoutes({
  accountActions,
  emailActions,
  endUserSessions,
  rateLimit,
  renderAccount,
  renderEmailResult,
  cookieName,
}) {
  return {
    async account({ request, profile, context, sendRemix }) {
      if (request.method !== "GET") throw fail(405, "Method not allowed.");
      await sendRemix((nonce) => renderAccount(profile, context, nonce));
    },
    async email({ request, form, session, context, sendRemix }) {
      if (request.method !== "POST") throw fail(405, "Method not allowed.");
      rateLimit(`email:${session.userId}`);
      await accountActions.provePassword(session, form.get("currentPassword"));
      await emailActions.setEmail(session.userId, form.get("email")?.trim());
      await sendRemix((nonce) =>
        renderEmailResult(
          "Check your email",
          "Open the verification link to confirm your address.",
          context,
          nonce,
        ),
      );
    },
    async password({ request, form, session, headers, sendRemix }) {
      if (request.method !== "POST") throw fail(405, "Method not allowed.");
      rateLimit(`password-change:${session.userId}`);
      if (form.get("password") !== form.get("confirmation"))
        throw fail(400, "The passwords do not match.");
      await accountActions.changePassword(
        session.userId,
        form.get("currentPassword"),
        form.get("password"),
      );
      await endUserSessions(session.userId);
      headers.set(
        "Set-Cookie",
        `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
      );
      await sendRemix((nonce) =>
        renderEmailResult(
          "Password updated",
          "Sign in with your new password.",
          {},
          nonce,
        ),
      );
    },
    async resendEmail({ request, session, profile, context, sendRemix }) {
      if (request.method !== "POST") throw fail(405, "Method not allowed.");
      if (
        !profile.human?.email?.email ||
        profile.human.email.email.endsWith(".invalid") ||
        profile.human.email.isEmailVerified
      )
        throw fail(
          400,
          "Add an unverified email address to your account first.",
        );
      rateLimit(`email:${session.userId}`);
      await emailActions.resend(session.userId);
      await sendRemix((nonce) =>
        renderEmailResult(
          "Check your email",
          "We sent a new verification link.",
          context,
          nonce,
        ),
      );
    },
  };
}
