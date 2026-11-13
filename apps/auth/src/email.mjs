const userPath = (id) => `/v2/users/${encodeURIComponent(id)}`;

export function createEmailActions(api, origin) {
  const emailLink = `${origin}/verify-email?userID={{.UserID}}&code={{.Code}}`;
  const resetLink = `${origin}/reset-password?userID={{.UserID}}&code={{.Code}}`;
  return {
    async passwordPolicy() {
      const { policy } = await api(
        "/management/v1/policies/password/complexity",
        { management: true },
      );
      const minimum = Number(policy?.minLength);
      if (!Number.isInteger(minimum) || minimum < 1 || minimum > 200)
        throw new Error("Invalid password policy");
      return {
        minLength: Math.max(12, minimum),
        hasUppercase: Boolean(policy.hasUppercase),
        hasLowercase: Boolean(policy.hasLowercase),
        hasNumber: Boolean(policy.hasNumber),
        hasSymbol: Boolean(policy.hasSymbol),
      };
    },
    async setEmail(userId, email) {
      if (
        typeof email !== "string" ||
        email.length > 200 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        /\.invalid$/i.test(email)
      ) {
        throw Object.assign(new Error("Enter a valid email address."), {
          status: 400,
        });
      }
      await api(`${userPath(userId)}/email`, {
        management: true,
        method: "POST",
        body: { email, sendCode: { urlTemplate: emailLink } },
      });
    },
    async resend(userId) {
      await api(`${userPath(userId)}/email/resend`, {
        management: true,
        method: "POST",
        body: { sendCode: { urlTemplate: emailLink } },
      });
    },
    async verify(userId, code) {
      await api(`${userPath(userId)}/email/verify`, {
        management: true,
        method: "POST",
        body: { verificationCode: code },
      });
    },
    async requestReset(login) {
      const key = typeof login === "string" ? login.trim() : "";
      if (!key || key.length > 250) return;
      const query = key.includes("@")
        ? {
            emailQuery: {
              emailAddress: key,
              method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE",
            },
          }
        : {
            userNameQuery: {
              userName: key,
              method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE",
            },
          };
      const result = await api("/management/v1/users/_search", {
        management: true,
        method: "POST",
        body: { query: { limit: "2" }, queries: [query] },
      });
      const user = result.result?.length === 1 ? result.result[0] : undefined;
      if (
        user?.state !== "USER_STATE_ACTIVE" ||
        !user.human?.email?.isEmailVerified ||
        user.human.email.email.endsWith(".invalid")
      )
        return;
      await api(`${userPath(user.id)}/password_reset`, {
        management: true,
        method: "POST",
        body: {
          sendLink: {
            notificationType: "NOTIFICATION_TYPE_Email",
            urlTemplate: resetLink,
          },
        },
      });
    },
    async resetPassword(userId, code, password) {
      if (
        typeof password !== "string" ||
        password.length < 12 ||
        password.length > 200
      ) {
        throw Object.assign(
          new Error("Use a password between 12 and 200 characters."),
          { status: 400 },
        );
      }
      if (!userId || !code)
        throw Object.assign(
          new Error("Open the link in your recovery email again."),
          { status: 400 },
        );
      try {
        await api(`${userPath(userId)}/password`, {
          management: true,
          method: "POST",
          body: {
            newPassword: { password, changeRequired: false },
            verificationCode: code,
          },
        });
      } catch (error) {
        if (error.passwordPolicyMessage)
          throw Object.assign(new Error(error.passwordPolicyMessage), {
            status: 400,
          });
        throw error;
      }
    },
  };
}
