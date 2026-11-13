import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRadioEnrollment } from "../src/radio-enrollment.mjs";
import { createAuthorizationActions } from "../src/authorization.mjs";

const app = {
  id: "radio",
  name: "Radio",
  projectId: "radio-project",
  clientIds: ["radio-client"],
  selfEnrollment: "verified-organization-human",
};
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "radio-enroll-"));
  let user = {
    id: "person",
    state: "USER_STATE_ACTIVE",
    human: { email: { isEmailVerified: true } },
    details: { resourceOwner: "org" },
  };
  let assigned = [],
    writes = 0,
    fail = false,
    loseReply = false,
    sessionValid = true;
  const request = {
    clientId: "radio-client",
    redirectUri: "https://radio.example/auth/callback",
    scope: ["openid", "profile"],
  };
  const api = async (path, options) => {
    if (path.startsWith("/v2/oidc/auth_requests/"))
      return options
        ? { callbackUrl: request.redirectUri + "?code=fixture" }
        : { authRequest: request };
    if (path.startsWith("/v2/sessions/"))
      return {
        session: {
          factors: {
            user: { id: "person" },
            password: { verifiedAt: new Date().toISOString() },
          },
          expirationDate: new Date(
            Date.now() + (sessionValid ? 60000 : -60000),
          ).toISOString(),
        },
      };
    if (path.endsWith("/grants/_search")) return { result: assigned };
    if (path.endsWith("/grants")) {
      writes++;
      assert.deepEqual(options.body, {
        projectId: app.projectId,
        roleKeys: ["member"],
      });
      if (fail) throw new Error("unknown provider outcome");
      assigned = [
        {
          id: "one",
          userId: "person",
          projectId: app.projectId,
          state: "USER_GRANT_STATE_ACTIVE",
          roleKeys: ["member"],
        },
      ];
      if (loseReply) throw new Error("response lost after commit");
      return { userGrantId: "one" };
    }
    return { user };
  };
  const filename = join(dir, "members.sqlite");
  let enrollment = createRadioEnrollment({
    filename,
    api,
    organizationId: "org",
  });
  t.after(() => {
    enrollment.close();
    rmSync(dir, { recursive: true });
  });
  return {
    api,
    get enrollment() {
      return enrollment;
    },
    peer() {
      return createRadioEnrollment({ filename, api, organizationId: "org" });
    },
    loseReply() {
      loseReply = true;
    },
    writes: () => writes,
    restart() {
      enrollment.close();
      enrollment = createRadioEnrollment({
        filename,
        api,
        organizationId: "org",
      });
    },
    expireSession() {
      sessionValid = false;
    },
    setUser(value) {
      user = value;
    },
    setGrants(value) {
      assigned = value;
    },
    fail() {
      fail = true;
    },
  };
}

test("explicit first-visit consent grants only Radio member; concurrent joins and restart never replace removed access", async (t) => {
  const f = fixture(t);
  assert.equal(await f.enrollment.inspect(app, "person"), true);
  await Promise.all([
    f.enrollment.join(app, "person"),
    f.enrollment.join(app, "person"),
  ]);
  assert.equal(f.writes(), 1);
  assert.equal(await f.enrollment.inspect(app, "person"), false);
  f.setGrants([]);
  f.restart();
  await assert.rejects(f.enrollment.inspect(app, "person"), { status: 403 });
  await assert.rejects(f.enrollment.join(app, "person"), { status: 403 });
  assert.equal(f.writes(), 1);
});

test("unknown provider write cannot be blindly retried after restart", async (t) => {
  const f = fixture(t);
  f.fail();
  await assert.rejects(
    f.enrollment.join(app, "person"),
    /unknown provider outcome/,
  );
  f.restart();
  await assert.rejects(f.enrollment.join(app, "person"), { status: 403 });
  assert.equal(f.writes(), 1);
});

test("disabled, unverified, foreign-org and machine accounts cannot self-enroll; inactive membership remains denied", async (t) => {
  const f = fixture(t);
  for (const user of [
    { id: "person", state: "USER_STATE_INACTIVE" },
    { id: "person", state: "USER_STATE_ACTIVE", machine: {} },
    {
      id: "person",
      state: "USER_STATE_ACTIVE",
      human: { email: { isEmailVerified: false } },
      details: { resourceOwner: "org" },
    },
    {
      id: "person",
      state: "USER_STATE_ACTIVE",
      human: { email: { isEmailVerified: true } },
      details: { resourceOwner: "other" },
    },
  ]) {
    f.setUser(user);
    await assert.rejects(f.enrollment.join(app, "person"), { status: 403 });
  }
  assert.equal(f.writes(), 0);
});

test("authorization GET and denied consent never create membership; approval requires viewed request and cannot be automatic", async (t) => {
  const f = fixture(t);
  const actions = createAuthorizationActions({
    api: f.api,
    applications: [app],
    grants: async () => [],
    organizationId: "org",
    radioEnrollment: f.enrollment,
  });
  const session = {
    userId: "person",
    sessionId: "proof",
    sessionToken: "proof",
  };
  await assert.rejects(actions.complete("one", session, "approve"), {
    status: 400,
  });
  assert.equal((await actions.view("one", session)).selfEnrollment, true);
  assert.equal(f.writes(), 0);
  await assert.rejects(actions.complete("one", session, "approve", true), {
    status: 400,
  });
  await actions.complete("one", session, "deny");
  assert.equal(f.writes(), 0);
  await actions.view("two", session);
  await actions.complete("two", session, "approve");
  assert.equal(f.writes(), 1);
});

test("observed preexisting access is terminal and inactive access never self-reactivates", async (t) => {
  const f = fixture(t);
  f.setGrants([
    {
      id: "old",
      userId: "person",
      projectId: app.projectId,
      state: "USER_GRANT_STATE_ACTIVE",
      roleKeys: ["member"],
    },
  ]);
  assert.equal(await f.enrollment.inspect(app, "person"), false);
  f.setGrants([]);
  f.restart();
  await assert.rejects(f.enrollment.inspect(app, "person"), { status: 403 });
  f.setGrants([
    {
      id: "old",
      userId: "person",
      projectId: app.projectId,
      state: "USER_GRANT_STATE_INACTIVE",
      roleKeys: ["member"],
    },
  ]);
  await assert.rejects(f.enrollment.join(app, "person"), { status: 403 });
  assert.equal(f.writes(), 0);
});

test("explicit operator denial survives restart even without a grant; only explicit operator approval clears it", async (t) => {
  const f = fixture(t);
  f.enrollment.deny(app, "person");
  f.restart();
  await assert.rejects(f.enrollment.join(app, "person"), { status: 403 });
  f.setGrants([
    {
      id: "approved",
      userId: "person",
      projectId: app.projectId,
      state: "USER_GRANT_STATE_ACTIVE",
      roleKeys: ["member"],
    },
  ]);
  await assert.rejects(f.enrollment.inspect(app, "person"), { status: 403 });
  await f.enrollment.approve(app, "person");
  assert.equal(await f.enrollment.inspect(app, "person"), false);
  assert.equal(f.writes(), 0);
});

test("Radio consent cannot use an expired provider password session", async (t) => {
  const f = fixture(t);
  f.expireSession();
  const actions = createAuthorizationActions({
    api: f.api,
    applications: [app],
    grants: async () => [],
    organizationId: "org",
    radioEnrollment: f.enrollment,
  });
  await assert.rejects(
    actions.view("one", {
      userId: "person",
      sessionId: "proof",
      sessionToken: "proof",
    }),
    { status: 403 },
  );
  assert.equal(f.writes(), 0);
});

test("independent ledger connections reserve one creation and never duplicate the grant", async (t) => {
  const f = fixture(t),
    peer = f.peer();
  t.after(() => peer.close());
  const results = await Promise.allSettled([
    f.enrollment.join(app, "person"),
    peer.join(app, "person"),
  ]);
  assert(results.some((r) => r.status === "fulfilled"));
  assert.equal(f.writes(), 1);
  assert.equal(await peer.inspect(app, "person"), false);
});

test("a lost provider reply after committed grant reconciles without another creation", async (t) => {
  const f = fixture(t);
  f.loseReply();
  await assert.rejects(
    f.enrollment.join(app, "person"),
    /response lost after commit/,
  );
  f.restart();
  assert.equal(await f.enrollment.inspect(app, "person"), false);
  await f.enrollment.join(app, "person");
  assert.equal(f.writes(), 1);
});
