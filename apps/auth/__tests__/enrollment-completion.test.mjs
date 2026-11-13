import test from "node:test";
import assert from "node:assert/strict";
import { createEnrollmentCompletion } from "../src/enrollment-completion.mjs";

const key = "fixture-only-key".repeat(4);
const input = {
  requestId: "request_12345678901234567890",
  subject: "verified-subject",
};
const application = {
  id: "fourm",
  projectId: "fourm-project",
  enrollment: {
    apiOrigin: "https://fourm.example",
    companionApplications: ["maps", "burger"],
  },
};
const applications = [
  application,
  ...["maps", "burger", "artbin", "lore"].map((id) => ({
    id,
    projectId: `${id}-project`,
    roles: ["member", "admin"],
  })),
];

function fixture() {
  const journal = new Map(),
    memberships = new Map(),
    writes = [],
    sourceCalls = [];
  const state = {
    proof: {
      ...input,
      issuer: "https://auth.jackharrhy.dev",
      userId: 42,
      completed: true,
      createdProfile: true,
      enabled: true,
    },
    user: {
      id: input.subject,
      state: "USER_STATE_ACTIVE",
      details: { resourceOwner: "org" },
      human: { email: { isEmailVerified: true } },
    },
    failBeforeWrite: false,
    failAfterWrite: false,
    failFinish: false,
    finishConflict: false,
  };
  const membership = (
    projectId,
    roleKeys = ["member"],
    grantState = "USER_GRANT_STATE_ACTIVE",
  ) => ({
    id: `grant-${projectId}`,
    userId: input.subject,
    projectId,
    roleKeys,
    state: grantState,
  });
  memberships.set(application.projectId, membership(application.projectId));
  const api = async (path, options = {}) => {
    assert.equal(options.management, true);
    if (path.endsWith("_search")) {
      const project = options.body.queries.find((query) => query.projectIdQuery)
        .projectIdQuery.projectId;
      return {
        result: memberships.has(project) ? [memberships.get(project)] : [],
      };
    }
    if (options.method !== "POST") return { user: state.user };
    writes.push(options.body);
    if (state.failBeforeWrite) {
      state.failBeforeWrite = false;
      throw new Error("Unknown network outcome");
    }
    memberships.set(
      options.body.projectId,
      membership(options.body.projectId, options.body.roleKeys),
    );
    if (state.failAfterWrite) {
      state.failAfterWrite = false;
      throw new Error("Unknown network outcome");
    }
    return {};
  };
  const request = async (url, options) => {
    assert.equal(url.origin, "https://fourm.example");
    assert.equal(options.headers.authorization, `Bearer ${key}`);
    sourceCalls.push(url.pathname);
    if (options.method === "GET")
      return Response.json(state.proofErrorStatus ? {} : state.proof, {
        status: state.proofErrorStatus || 200,
      });
    const body = JSON.parse(options.body);
    const [id, operation] = url.pathname.split("/").slice(-2);
    assert.ok(["maps", "burger"].includes(id));
    assert.equal(body.subject, input.subject);
    if (operation === "reserve" && !journal.has(id))
      journal.set(id, {
        ...input,
        applicationId: id,
        state: "reserved",
        attemptId: body.attemptId,
      });
    if (operation === "finish") {
      if (state.failFinish) {
        state.failFinish = false;
        return Response.json({}, { status: 503 });
      }
      assert.equal(body.attemptId, journal.get(id).attemptId);
      assert.ok(["created", "preserved"].includes(body.outcome));
      assert.ok(body.grantId);
      if (state.finishConflict) {
        state.finishConflict = false;
        journal.set(id, {
          ...journal.get(id),
          state: "done",
          grantId: body.grantId,
          outcome: "preserved",
        });
        return Response.json({}, { status: 409 });
      }
      const current = journal.get(id);
      if (
        current.state === "done" &&
        (current.grantId !== body.grantId || current.outcome !== body.outcome)
      )
        return Response.json({}, { status: 409 });
      journal.set(id, {
        ...current,
        state: "done",
        grantId: body.grantId,
        outcome: body.outcome,
      });
    }
    return Response.json(journal.get(id));
  };
  return {
    state,
    journal,
    memberships,
    writes,
    sourceCalls,
    membership,
    actions: () =>
      createEnrollmentCompletion({
        api,
        application,
        applications,
        organizationId: "org",
        key,
        request,
      }),
  };
}

test("committed new profiles receive only Maps and Burger member grants, never pre-callback or admin grants", async () => {
  const f = fixture();
  assert.deepEqual(await f.actions().complete(input), {
    requestId: input.requestId,
    completed: true,
  });
  assert.deepEqual(f.writes, [
    { projectId: "maps-project", roleKeys: ["member"] },
    { projectId: "burger-project", roleKeys: ["member"] },
  ]);
  assert.ok([...f.journal.values()].every((value) => value.state === "done"));
  for (const changed of [
    { completed: false },
    { createdProfile: false },
    { enabled: false },
    { subject: "other" },
    { issuer: "https://wrong.example" },
  ]) {
    const denied = fixture();
    denied.state.proof = { ...denied.state.proof, ...changed };
    await assert.rejects(denied.actions().complete(input), { status: 409 });
    assert.equal(denied.writes.length, 0);
    assert.equal(denied.journal.size, 0);
  }
});

test("completion validates payload and active verified owned human membership without name or metadata linking", async () => {
  const f = fixture();
  for (const value of [
    { ...input, projectId: "lore-project" },
    { ...input, role: "admin" },
    { ...input, username: "known-name" },
    { ...input, subject: "" },
  ])
    await assert.rejects(f.actions().complete(value), { status: 400 });
  assert.equal(f.sourceCalls.length, 0);
  for (const change of [
    (user) => (user.state = "USER_STATE_INACTIVE"),
    (user) => (user.human = undefined),
    (user) => (user.human.email.isEmailVerified = false),
    (user) => (user.details.resourceOwner = "other-org"),
  ]) {
    const denied = fixture();
    change(denied.state.user);
    await assert.rejects(denied.actions().complete(input), { status: 403 });
    assert.equal(denied.writes.length, 0);
  }
  const denied = fixture();
  denied.memberships.get("fourm-project").state = "USER_GRANT_STATE_INACTIVE";
  await assert.rejects(denied.actions().complete(input), { status: 403 });
});

test("durable receipts survive handler restart and never regrant after intentional deletion", async () => {
  const f = fixture();
  await f.actions().complete(input);
  f.memberships.delete("maps-project");
  f.memberships.delete("burger-project");
  await f.actions().complete(input);
  assert.equal(f.writes.length, 2);
  assert.equal(f.memberships.has("maps-project"), false);
});

test("lost finish acknowledgment and unknown successful write are reconciled by observation, not repeated grant creation", async () => {
  for (const flag of ["failFinish", "failAfterWrite"]) {
    const f = fixture();
    f.state[flag] = true;
    await assert.rejects(f.actions().complete(input));
    await f.actions().complete(input);
    assert.equal(f.writes.length, 2);
    assert.ok([...f.journal.values()].every((value) => value.state === "done"));
  }
});

test("an unobservable reserved side effect is never retried, including deletion before acknowledgment", async () => {
  for (const afterWrite of [false, true]) {
    const f = fixture();
    f.state[afterWrite ? "failAfterWrite" : "failBeforeWrite"] = true;
    await assert.rejects(f.actions().complete(input));
    f.memberships.delete("maps-project");
    await assert.rejects(f.actions().complete(input), {
      status: 409,
      code: "enrollment_grant_ambiguous",
    });
    assert.equal(f.writes.length, 1);
    assert.equal(f.memberships.has("maps-project"), false);
  }
});

test("existing suspended or custom companion grants are preserved without role widening", async () => {
  const f = fixture();
  f.memberships.set(
    "maps-project",
    f.membership(
      "maps-project",
      ["restricted-role"],
      "USER_GRANT_STATE_INACTIVE",
    ),
  );
  f.memberships.set(
    "burger-project",
    f.membership("burger-project", ["admin"]),
  );
  const before = structuredClone([...f.memberships]);
  await f.actions().complete(input);
  assert.equal(f.writes.length, 0);
  assert.deepEqual([...f.memberships], before);
});

test("concurrent completion attempts cannot create duplicate grants", async () => {
  const f = fixture();
  const result = await Promise.allSettled([
    f.actions().complete(input),
    f.actions().complete(input),
  ]);
  assert.ok(result.some((value) => value.status === "fulfilled"));
  assert.equal(
    f.writes.filter((value) => value.projectId === "maps-project").length,
    1,
  );
  assert.equal(
    f.writes.filter((value) => value.projectId === "burger-project").length,
    1,
  );
});

test("unavailable or unauthenticated source proof cannot create memberships", async () => {
  for (const [upstream, expected] of [
    [404, 409],
    [401, 502],
    [503, 502],
  ]) {
    const f = fixture();
    f.state.proofErrorStatus = upstream;
    await assert.rejects(f.actions().complete(input), { status: expected });
    assert.equal(f.writes.length, 0);
    assert.equal(f.journal.size, 0);
  }
});

test("a conflicting finish acknowledgment observes terminal completion without replaying a grant", async () => {
  const f = fixture();
  f.state.finishConflict = true;
  assert.deepEqual(await f.actions().complete(input), {
    requestId: input.requestId,
    completed: true,
  });
  assert.equal(f.writes.length, 2);
  assert.ok([...f.journal.values()].every((value) => value.state === "done"));
});
