import test from "node:test";
import assert from "node:assert/strict";
import { directoryFor } from "../src/directory.mjs";

test("directory distinguishes entitlement, setup, opt-in and public from hidden integrations", () => {
  const services = [
    { id: "ordinary", applicationId: "app", kind: "central" },
    {
      id: "fixed",
      applicationId: "app",
      kind: "fixed",
      assignmentGuard: "reviewed-link",
    },
    { id: "held", applicationId: "held", kind: "central" },
    { id: "join", kind: "join" },
    { id: "public", kind: "public" },
    { id: "retired", kind: "retired" },
    { id: "unknown", kind: "unknown" },
  ];
  const applications = [
    { id: "app", projectId: "project", roles: ["member"] },
    { id: "held", projectId: "held", authorizationHold: true },
  ];
  const access = {
    initialized: () => true,
    directoryBindings: () => [],
    blocked: () => false,
    read: () => ({ links: [] }),
    sources: () => [],
  };
  const input = {
    services,
    applications,
    subject: "person",
    access,
    grants: [
      {
        userId: "person",
        projectId: "project",
        state: "USER_GRANT_STATE_ACTIVE",
        roleKeys: ["member"],
      },
    ],
  };
  const result = directoryFor(input);
  assert.deepEqual(
    result.map((item) => item.id),
    ["ordinary", "fixed", "join", "public"],
  );
  assert.equal(result.find((item) => item.id === "fixed").setupRequired, true);
  assert.equal(result.find((item) => item.id === "join").status, "Join");
  access.blocked = (_, project) => project === "project";
  assert.deepEqual(
    directoryFor(input).map((item) => item.id),
    ["join", "public"],
  );
  access.blocked = () => false;
  input.grants[0].roleKeys = [];
  assert.deepEqual(
    directoryFor(input).map((item) => item.id),
    ["join", "public"],
  );
  input.grants[0].state = "USER_GRANT_STATE_INACTIVE";
  assert.deepEqual(
    directoryFor(input).map((item) => item.id),
    ["join", "public"],
  );
});

test("directory grouping appears for a larger mixed directory and collapses for a small one", async () => {
  const { directorySections } = await import("../src/directory.mjs");
  const items = Array.from({ length: 6 }, (_, index) => ({
    id: String(index),
    directorySection: ["apps", "media", "tools"][index % 3],
  }));
  assert.deepEqual(
    directorySections(items).map((section) => section.title),
    ["Apps", "Media", "Your tools"],
  );
  assert.equal(directorySections(items.slice(0, 5))[0].title, null);
  assert.equal(
    directorySections(
      items.map((item) => ({ ...item, directorySection: "apps" })),
    )[0].title,
    null,
  );
  assert.deepEqual(
    directorySections(items)
      .flatMap((section) => section.items)
      .map((item) => item.id)
      .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    items.map((item) => item.id),
  );
});
