import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../../server/db";
import {
  upsertUserFromIdentity,
  getUserById,
} from "../../../server/auth/users";

const setupDb = (): Database => {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
};

test("upsertUserFromIdentity creates a new user on first call", () => {
  const db = setupDb();
  const u = upsertUserFromIdentity(db, {
    subject: "subject1",
    username: "jack",
    displayName: "Jack",
    isAdmin: true,
  });
  expect(u.username).toBe("jack");
  expect(u.displayName).toBe("Jack");
  expect(u.isAdmin).toBe(true);
  expect(u.id.length).toBeGreaterThan(0);
});

test("upsertUserFromIdentity returns same user for the same subject", () => {
  const db = setupDb();
  const u1 = upsertUserFromIdentity(db, {
    subject: "subject1",
    username: "jack",
    displayName: null,
    isAdmin: false,
  });
  const u2 = upsertUserFromIdentity(db, {
    subject: "subject1",
    username: "jack",
    displayName: null,
    isAdmin: false,
  });
  expect(u2.id).toBe(u1.id);
});

test("upsertUserFromIdentity keeps the local ID for an existing central subject", () => {
  const db = setupDb();
  db.run(
    "INSERT INTO users (id, fourm_id, auth_subject, username, is_admin, created_at) VALUES ('existing', '1', 'subject1', 'old', 0, 0)",
  );

  const user = upsertUserFromIdentity(db, {
    subject: "subject1",
    username: "jack",
    displayName: "Jack",
    isAdmin: false,
  });

  expect(user.id).toBe("existing");
});

test("upsertUserFromIdentity creates a central-only Burger member", () => {
  const db = setupDb();
  const user = upsertUserFromIdentity(db, {
    subject: "subject2",
    username: "new-user",
    displayName: null,
    isAdmin: false,
  });

  expect(user.authSubject).toBe("subject2");
});

test("upsertUserFromIdentity updates profile and admin role", () => {
  const db = setupDb();
  const u1 = upsertUserFromIdentity(db, {
    subject: "subject1",
    username: "old",
    displayName: null,
    isAdmin: false,
  });
  const u2 = upsertUserFromIdentity(db, {
    subject: "subject1",
    username: "new",
    displayName: "New",
    isAdmin: true,
  });
  expect(u2.id).toBe(u1.id);
  expect(u2.username).toBe("new");
  expect(u2.displayName).toBe("New");
  expect(u2.isAdmin).toBe(true);
});

test("getUserById returns the user", () => {
  const db = setupDb();
  const u = upsertUserFromIdentity(db, {
    subject: "subject1",
    username: "jack",
    displayName: null,
    isAdmin: false,
  });
  const fetched = getUserById(db, u.id);
  expect(fetched?.username).toBe("jack");
});

test("getUserById returns null for missing user", () => {
  const db = setupDb();
  expect(getUserById(db, "missing")).toBeNull();
});
