import assert from "node:assert/strict";
import test from "node:test";
import { createEnrollmentRoutes } from "../src/enrollment-routes.mjs";

function fixture(verified) {
  const sessions = new Map([["guest", {}]]);
  const routes = createEnrollmentRoutes({
    enrollment: {
      async pending(ticket) {
        assert.equal(ticket, "invite");
      },
      async createUser(ticket, input) {
        assert.equal(ticket, "invite");
        assert.equal(input.username, "person");
        return "user";
      },
    },
    organizationId: "org",
    async api(path) {
      if (path === "/v2/sessions")
        return { sessionId: "provider-session", sessionToken: "private" };
      return {
        session: {
          factors: {
            user: { id: verified ? "user" : "another-user" },
            password: { verifiedAt: "now" },
          },
        },
      };
    },
    rateLimit() {},
    sessions,
    newSession: () => ({ id: "signed-in" }),
    cookie: (session) => `session=${session.id}`,
    renderEnrollment() {},
  });
  const input = {
    request: { method: "POST" },
    url: new URL("https://auth.test/enroll"),
    form: new URLSearchParams({
      username: "person",
      password: "example",
      confirmation: "example",
    }),
    session: { id: "guest", enrollmentTicket: "invite" },
    context: {},
    headers: new Headers(),
    sendRemix() {},
    redirect(path) {
      assert.equal(path, "/enroll");
    },
    setSession(next) {
      input.nextSession = next;
    },
  };
  return { routes, input, sessions };
}

test("invite enrollment waits for provider password verification before issuing a browser cookie", async () => {
  const rejected = fixture(false);
  await assert.rejects(rejected.routes.beforeAuth(rejected.input), {
    status: 401,
  });
  assert.equal(rejected.input.headers.has("Set-Cookie"), false);
  assert.equal(rejected.input.nextSession, undefined);
  assert.equal(rejected.sessions.has("guest"), true);

  const accepted = fixture(true);
  assert.equal(await accepted.routes.beforeAuth(accepted.input), true);
  assert.equal(accepted.input.nextSession.userId, "user");
  assert.equal(accepted.input.nextSession.enrollmentTicket, "invite");
  assert.equal(accepted.input.headers.get("Set-Cookie"), "session=signed-in");
  assert.equal(accepted.sessions.has("guest"), false);
});
