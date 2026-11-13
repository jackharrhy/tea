import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createAccessStore } from "../src/access-store.mjs";

function fixture(t) {
  const directory = mkdtempSync(`${tmpdir()}/auth-access-`);
  const applications = [
    { id: "maps", projectId: "maps-project", roles: ["member", "admin"] },
    { id: "media-admin", projectId: "media-project", roles: ["admin"] },
    {
      id: "cms",
      projectId: "cms-project",
      roles: ["admin"],
      authorizationHold: true,
    },
  ];
  let grants = [
    {
      id: "maps-grant",
      userId: "person",
      projectId: "maps-project",
      state: "USER_GRANT_STATE_ACTIVE",
      roleKeys: ["member", "unknown-native-role"],
    },
  ];
  let writes = 0,
    failAfterWrite = false;
  const native = {
    list: async (subject) =>
      structuredClone(
        grants.filter((item) => !subject || item.userId === subject),
      ),
    write: async (before, after) => {
      writes++;
      grants = grants.filter((item) => item.id !== before?.id);
      if (after.roleKeys.length)
        grants.push({
          ...after,
          id: before?.id || "created",
          state: "USER_GRANT_STATE_ACTIVE",
        });
      if (failAfterWrite) throw new Error("Lost response");
    },
  };
  const store = createAccessStore({
    filename: `${directory}/access.sqlite`,
    applications,
    services: [
      {
        id: "sonarr",
        applicationId: "media-admin",
        assignmentGuard: "reviewed-link",
      },
    ],
    native,
  });
  store.bootstrap({ administrator: "operator", grants });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const apply = async (change) => {
    const preview = await store.preview(
      {
        ...change,
        revision: store.read().revision,
        reason: "Reviewed fixture change",
      },
      "operator",
    );
    return store.apply(preview.id, "operator");
  };
  return {
    store,
    apply,
    native,
    get grants() {
      return grants;
    },
    set grants(value) {
      grants = value;
    },
    get writes() {
      return writes;
    },
    set failAfterWrite(value) {
      failAfterWrite = value;
    },
  };
}

test("group/direct overlap preserves other sources and all unknown native permissions", async (t) => {
  const f = fixture(t);
  await f.apply({
    type: "group.save",
    name: "Map makers",
    bindings: [{ application: "maps", role: "member" }],
  });
  const group = f.store
    .read()
    .groups.find((item) => item.name === "Map makers").id;
  await f.apply({ type: "membership.add", group, subject: "person" });
  assert.equal(f.writes, 0);
  await f.apply({
    type: "direct.set",
    subject: "person",
    application: "maps",
    roles: [],
  });
  assert.equal(f.writes, 0);
  assert.deepEqual(f.grants[0].roleKeys, ["member", "unknown-native-role"]);
  await f.apply({ type: "membership.remove", group, subject: "person" });
  assert.deepEqual(f.grants[0].roleKeys, ["unknown-native-role"]);
  assert.equal(f.store.operations()[0].state, "cleanup-pending");
});

test("service block overrides group access and records external cleanup", async (t) => {
  const f = fixture(t);
  const result = await f.apply({
    type: "service.block",
    subject: "person",
    application: "maps",
  });
  assert.equal(f.grants.length, 0);
  assert.equal(f.store.blocked("person", "maps-project"), true);
  assert.equal(result.state, "cleanup-pending");
  assert.equal(result.body.cleanup[0].state, "manual-required");
  f.store.completeCleanup(
    result.id,
    0,
    "operator",
    "Verified native app session and credentials removed",
  );
  assert.equal(f.store.operation(result.id).state, "complete");
});

test("last administrator, held services and unreviewed native mappings cannot be changed accidentally", async (t) => {
  const f = fixture(t);
  assert.equal(f.store.isAdministrator("operator"), true);
  assert.equal(f.store.isAdministrator("person"), false);
  await assert.rejects(
    f.apply({
      type: "membership.remove",
      group: "auth-administrators",
      subject: "operator",
    }),
    /at least one/,
  );
  await assert.rejects(
    f.apply({
      type: "group.save",
      name: "CMS editors",
      bindings: [{ application: "cms", role: "admin" }],
    }),
    /held/,
  );
  await assert.rejects(
    f.apply({
      type: "direct.set",
      subject: "person",
      application: "media-admin",
      roles: ["admin"],
    }),
    /reviewed native account link/,
  );
  assert.equal(f.writes, 0);
});

test("stale previews and external native removal never silently regrant", async (t) => {
  const f = fixture(t);
  const preview = await f.store.preview(
    {
      type: "direct.set",
      subject: "person",
      application: "maps",
      roles: ["admin"],
      revision: 1,
      reason: "Promote for fixture",
    },
    "operator",
  );
  f.grants = [];
  await assert.rejects(f.store.apply(preview.id, "operator"), /outside/);
  assert.equal(f.writes, 0);
  f.grants = [
    {
      id: "maps-grant",
      userId: "person",
      projectId: "maps-project",
      state: "USER_GRANT_STATE_ACTIVE",
      roleKeys: ["member", "unknown-native-role"],
    },
  ];
  await f.apply({ type: "group.save", name: "Other group", bindings: [] });
  await assert.rejects(f.store.apply(preview.id, "operator"), /changed/);
});

test("ambiguous native success is durable and cannot be retried as another creation", async (t) => {
  const f = fixture(t);
  f.failAfterWrite = true;
  await assert.rejects(
    f.apply({
      type: "direct.set",
      subject: "person",
      application: "maps",
      roles: ["admin"],
    }),
    /partly applied/,
  );
  assert.equal(f.writes, 1);
  const operation = f.store.operations()[0];
  assert.equal(operation.state, "unknown");
  const replay = await f.store.apply(operation.id, "operator");
  assert.equal(replay.state, "unknown");
  assert.equal(f.writes, 1);
  await assert.rejects(
    f.apply({ type: "group.save", name: "Another group", bindings: [] }),
    /reconciliation/,
  );
  const resolved = await f.store.reconcile(operation.id, "operator");
  assert.equal(resolved.state, "cleanup-pending");
  assert.equal(
    f.writes,
    1,
    "readback reconciliation must not replay native writes",
  );
});
