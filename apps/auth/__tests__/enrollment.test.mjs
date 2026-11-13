import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createEnrollmentActions } from "../src/enrollment.mjs";

const key = "a".repeat(64),
  now = 1_000_000_000_000;
const application = {
  id: "fourm",
  projectId: "fourm-project",
  enrollment: {
    apiOrigin: "https://fourm.example",
    returnUrl: "https://fourm.example/auth/start?next=register",
  },
};
const payload = {
  version: 1,
  application: "fourm",
  requestId: "request_12345678901234567890",
  expires: now / 1000 + 1800,
};
function signed(value) {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encoded}.${createHmac("sha256", key).update(encoded).digest("base64url")}`;
}
const state = {
  requestId: payload.requestId,
  expiresAt: payload.expires,
  completed: false,
};

test("invites require an authentic signature, the configured application and a live reservation", async () => {
  let calls = 0;
  const actions = createEnrollmentActions({
    api: async () => ({}),
    application,
    key,
    origin: "https://auth.example",
    now: () => now,
    request: async () => {
      calls++;
      return Response.json(state);
    },
  });
  await assert.rejects(actions.pending(signed(payload) + "x"), { status: 400 });
  await assert.rejects(
    actions.pending(signed({ ...payload, application: "lore" })),
    { status: 400 },
  );
  await assert.rejects(
    actions.pending(signed({ ...payload, expires: now / 1000 - 1 })),
    { status: 400 },
  );
  assert.equal(calls, 0);
  assert.equal(
    (await actions.pending(signed(payload))).requestId,
    payload.requestId,
  );
});

test("unverified identities cannot claim membership; grants are limited to 4orm", async () => {
  const writes = [];
  const actions = createEnrollmentActions({
    application,
    key,
    origin: "https://auth.example",
    now: () => now,
    request: async (url, options) =>
      Response.json(
        options.method === "POST" ? { ...state, subject: "user" } : state,
      ),
    api: async (path, options) => {
      writes.push({ path, body: options.body });
      return path.endsWith("_search") ? {} : {};
    },
  });
  const user = {
    id: "user",
    userName: "person",
    human: { email: { email: "person@example.com", isEmailVerified: false } },
  };
  await assert.rejects(actions.continue(signed(payload), user), {
    status: 400,
  });
  assert.equal(writes.length, 0);
  user.human.email.isEmailVerified = true;
  assert.equal(
    await actions.continue(signed(payload), user),
    application.enrollment.returnUrl,
  );
  assert.deepEqual(writes.at(-1).body, {
    projectId: "fourm-project",
    roleKeys: ["member"],
  });
});

test("a completed reservation cannot be reused to create an account", async () => {
  let writes = 0;
  const actions = createEnrollmentActions({
    application,
    key,
    origin: "https://auth.example",
    now: () => now,
    request: async () => Response.json({ ...state, completed: true }),
    api: async () => {
      writes++;
    },
  });
  await assert.rejects(
    actions.createUser(
      signed(payload),
      {
        username: "person",
        email: "person@example.com",
        password: "Password123!",
      },
      "org",
    ),
    { status: 400 },
  );
  assert.equal(writes, 0);
});

test("invite membership includes configured own-content API roles while preserving existing roles", async () => {
  const writes = [];
  const actions = createEnrollmentActions({
    application: { ...application, apiRoles: ["pages-read", "media-read"] },
    key,
    origin: "https://auth.example",
    now: () => now,
    request: async (url, options) =>
      Response.json(
        options.method === "POST" ? { ...state, subject: "user" } : state,
      ),
    api: async (path, options) => {
      if (path.endsWith("_search"))
        return {
          result: [{ id: "grant", roleKeys: ["member", "existing-role"] }],
        };
      writes.push({ path, ...options });
      return {};
    },
  });
  await actions.continue(signed(payload), {
    id: "user",
    userName: "person",
    human: { email: { email: "person@example.com", isEmailVerified: true } },
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/management/v1/users/user/grants/grant");
  assert.deepEqual(writes[0].body.roleKeys, [
    "member",
    "existing-role",
    "pages-read",
    "media-read",
  ]);
});

test("account retries keep one provider identity and validate the source binding", async () => {
  const providerCalls = [],
    subjects = [];
  const actions = createEnrollmentActions({
    application,
    key,
    origin: "https://auth.example",
    now: () => now,
    request: async (url, options) => {
      if (options.method === "POST") {
        const body = JSON.parse(options.body);
        subjects.push(body.subject);
        return Response.json({ ...state, subject: body.subject });
      }
      return Response.json(state);
    },
    api: async (path, options) => {
      providerCalls.push({ path, options });
      return { user: { id: path.split("/").at(-1) } };
    },
  });
  const fields = {
    username: "person",
    email: "person@example.com",
    password: "long-password-123",
  };
  const first = await actions.createUser(signed(payload), fields, "org");
  assert.equal(await actions.createUser(signed(payload), fields, "org"), first);
  assert.deepEqual(subjects, [first, first]);
  assert.equal(
    providerCalls.filter((call) => call.options.method === "POST").length,
    0,
  );
  const mismatch = createEnrollmentActions({
    application,
    key,
    origin: "https://auth.example",
    now: () => now,
    request: async (url, options) =>
      Response.json(
        options.method === "POST" ? { ...state, subject: "different" } : state,
      ),
    api: async () => {
      throw new Error("must not reach provider");
    },
  });
  await assert.rejects(
    mismatch.createUser(signed(payload), fields, "org"),
    /different identity binding/,
  );
});

test("enrollment rejects invalid keys and local usernames before creating an account", async () => {
  assert.throws(
    () =>
      createEnrollmentActions({
        application,
        key: {},
        origin: "https://auth.example",
      }),
    /Invalid enrollment/,
  );
  let writes = 0;
  const actions = createEnrollmentActions({
    application,
    key,
    origin: "https://auth.example",
    now: () => now,
    request: async () => Response.json(state),
    api: async () => {
      writes++;
    },
  });
  await assert.rejects(
    actions.createUser(
      signed(payload),
      {
        username: "ab",
        email: "person@example.com",
        password: "long-password-123",
      },
      "org",
    ),
    { status: 400 },
  );
  assert.equal(writes, 0);
});
