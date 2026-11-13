import { createHash, createHmac } from "node:crypto";
import { equalToken } from "./security.mjs";
import { applicationRoleKeys } from "./applications.mjs";

const invalid = (message) => Object.assign(new Error(message), { status: 400 });
export function createEnrollmentActions({
  api,
  application,
  key,
  origin,
  request = fetch,
  now = Date.now,
}) {
  if (application.id !== "fourm" || typeof key !== "string" || key.length < 32)
    throw new Error("Invalid enrollment configuration");
  const apiOrigin = new URL(application.enrollment.apiOrigin);
  const returnUrl = new URL(application.enrollment.returnUrl);
  if (
    apiOrigin.protocol !== "https:" ||
    returnUrl.protocol !== "https:" ||
    apiOrigin.origin !== returnUrl.origin
  )
    throw new Error("Enrollment requires one trusted HTTPS application origin");
  async function applicationRequest(path, body) {
    const response = await request(new URL(path, apiOrigin), {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      if ([400, 404, 409, 410].includes(response.status))
        throw invalid(
          "This invite is unavailable. Open a new invite link or sign in to your existing account.",
        );
      throw new Error("The application could not validate this invite.");
    }
    return response.json();
  }
  function decode(ticket) {
    if (typeof ticket !== "string" || ticket.length > 2048)
      throw invalid("Invalid invite link.");
    const [encoded, signature, extra] = ticket.split(".");
    if (
      !encoded ||
      !signature ||
      extra ||
      !equalToken(
        signature,
        createHmac("sha256", key).update(encoded).digest("base64url"),
      )
    )
      throw invalid("Invalid invite link.");
    let value;
    try {
      value = JSON.parse(Buffer.from(encoded, "base64url"));
    } catch {
      throw invalid("Invalid invite link.");
    }
    const seconds = Math.floor(now() / 1000);
    if (
      value.version !== 1 ||
      value.application !== application.id ||
      !/^[A-Za-z0-9_-]{20,64}$/.test(value.requestId || "") ||
      !Number.isSafeInteger(value.expires) ||
      value.expires <= seconds ||
      value.expires > seconds + 1800
    )
      throw invalid("This invite link has expired or is invalid.");
    return value;
  }
  async function pending(ticket) {
    const value = decode(ticket);
    const state = await applicationRequest(
      `/internal/auth/enrollments/${encodeURIComponent(value.requestId)}`,
    );
    if (
      state.requestId !== value.requestId ||
      state.expiresAt !== value.expires ||
      state.completed
    )
      throw invalid("This registration is already complete or has expired.");
    return state;
  }
  async function claim(ticket, user) {
    const state = await pending(ticket);
    const result = await applicationRequest(
      `/internal/auth/enrollments/${encodeURIComponent(state.requestId)}/claim`,
      {
        subject: user.id,
        username: user.userName,
        displayName: user.human?.profile?.displayName || user.userName,
      },
    );
    if (result.subject !== user.id || result.requestId !== state.requestId)
      throw new Error("The application returned a different identity binding.");
    return result;
  }
  return {
    pending,
    async createUser(ticket, { username, email, password }, organizationId) {
      const state = await pending(ticket);
      if (
        !/^[a-z0-9_-]{3,32}$/.test(username || "") ||
        typeof password !== "string" ||
        password.length < 12 ||
        password.length > 200 ||
        typeof email !== "string" ||
        email.length > 200 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        /\.invalid$/i.test(email)
      )
        throw invalid("Check your username, email and password.");
      const digest = createHash("sha256")
        .update(`fourm-enrollment:${state.requestId}`)
        .digest("hex");
      const userId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      // Reserve the local name before creating a provider identity.
      await claim(ticket, {
        id: userId,
        userName: username,
        human: { profile: { displayName: username } },
      });
      let existing;
      try {
        existing = (
          await api(`/management/v1/users/${userId}`, { management: true })
        ).user;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      if (!existing)
        await api("/v2/users/human", {
          management: true,
          method: "POST",
          body: {
            userId,
            username,
            organization: { orgId: organizationId },
            profile: {
              givenName: username,
              familyName: "User",
              displayName: username,
            },
            email: {
              email,
              sendCode: {
                urlTemplate: `${origin}/verify-email?userID={{.UserID}}&code={{.Code}}`,
              },
            },
            password: { password, changeRequired: false },
          },
        });
      // The caller must prove this password through the session API before using the identity.
      return userId;
    },
    async continue(ticket, user) {
      if (
        !user.human?.email?.isEmailVerified ||
        user.human.email.email.endsWith(".invalid")
      )
        throw invalid(
          "Verify your email address from Account before continuing.",
        );
      await claim(ticket, user);
      const response = await api("/management/v1/users/grants/_search", {
        management: true,
        method: "POST",
        body: {
          query: { limit: "2" },
          queries: [
            { userIdQuery: { userId: user.id } },
            { projectIdQuery: { projectId: application.projectId } },
          ],
        },
      });
      const grant = response.result?.[0];
      const roles = applicationRoleKeys(application, "member");
      if (!grant)
        await api(
          `/management/v1/users/${encodeURIComponent(user.id)}/grants`,
          {
            management: true,
            method: "POST",
            body: { projectId: application.projectId, roleKeys: roles },
          },
        );
      else if (roles.some((role) => !grant.roleKeys.includes(role)))
        await api(
          `/management/v1/users/${encodeURIComponent(user.id)}/grants/${encodeURIComponent(grant.id)}`,
          {
            management: true,
            method: "PUT",
            body: { roleKeys: [...new Set([...grant.roleKeys, ...roles])] },
          },
        );
      return returnUrl.href;
    },
  };
}
