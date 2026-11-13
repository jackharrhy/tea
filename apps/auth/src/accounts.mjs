export function createAccountActions(api, organizationId) {
  return {
    async loginUser(value) {
      const login = typeof value === "string" ? value.trim() : "";
      if (!login || login.length > 250)
        throw Object.assign(new Error("Sign-in failed."), { status: 401 });
      if (!login.includes("@")) return { loginName: login };
      const response = await api("/management/v1/users/_search", {
        management: true,
        method: "POST",
        body: {
          query: { limit: "2" },
          queries: [
            {
              emailQuery: {
                emailAddress: login,
                method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE",
              },
            },
          ],
        },
      });
      const user =
        response.result?.length === 1 ? response.result[0] : undefined;
      if (
        user?.state !== "USER_STATE_ACTIVE" ||
        !user.human?.email?.isEmailVerified
      ) {
        throw Object.assign(new Error("Sign-in failed."), { status: 401 });
      }
      return { userId: user.id };
    },
    async managedUser(userId) {
      const user = (
        await api(`/management/v1/users/${encodeURIComponent(userId)}`, {
          management: true,
        })
      ).user;
      if (!user?.human || user.details?.resourceOwner !== organizationId) {
        throw Object.assign(new Error("User is outside this organization."), {
          status: 403,
        });
      }
      return user;
    },
    async provePassword(session, password) {
      if (typeof password !== "string" || !password || password.length > 200) {
        throw Object.assign(new Error("Enter your current password."), {
          status: 400,
        });
      }
      try {
        const result = await api(
          `/v2/sessions/${encodeURIComponent(session.sessionId)}`,
          {
            method: "PATCH",
            body: {
              sessionToken: session.sessionToken,
              checks: { password: { password } },
            },
          },
        );
        if (result.sessionToken) session.sessionToken = result.sessionToken;
      } catch (error) {
        if (![400, 403].includes(error.status)) throw error;
        throw Object.assign(
          new Error("Your current password was not accepted."),
          { status: 400 },
        );
      }
    },
    async changePassword(userId, currentPassword, password) {
      if (
        typeof currentPassword !== "string" ||
        !currentPassword ||
        currentPassword.length > 200
      ) {
        throw Object.assign(new Error("Enter your current password."), {
          status: 400,
        });
      }
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
      await api(`/v2/users/${encodeURIComponent(userId)}/password`, {
        method: "POST",
        management: true,
        body: {
          currentPassword,
          newPassword: { password, changeRequired: false },
        },
      });
    },
    async recoveryLink(userId, origin) {
      const result = await api(
        `/v2/users/${encodeURIComponent(userId)}/password_reset`,
        {
          management: true,
          method: "POST",
          body: { returnCode: {} },
        },
      );
      if (!result.verificationCode)
        throw new Error("The identity provider returned no recovery code.");
      const query = new URLSearchParams({
        userID: userId,
        code: result.verificationCode,
      });
      return `${origin}/reset-password?${query}`;
    },
    async setActive(userId, active, state) {
      const action = active
        ? state === "USER_STATE_LOCKED"
          ? "_unlock"
          : "_reactivate"
        : "_deactivate";
      await api(
        `/management/v1/users/${encodeURIComponent(userId)}/${action}`,
        { management: true, method: "POST", body: {} },
      );
    },
  };
}
