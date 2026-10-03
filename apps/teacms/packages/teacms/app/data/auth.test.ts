import { it } from "remix/test";
import * as assert from "remix/assert";
import bcrypt from "bcryptjs";
import { openDatabase } from "./database.ts";
import { AuthStore } from "./auth.ts";

it("verifies passwords, expires and revokes opaque sessions", async () => {
  const { sqlite } = await openDatabase(":memory:");
  sqlite
    .prepare("INSERT INTO users (email,password_hash) VALUES (?,?)")
    .run("editor@test.local", await bcrypt.hash("correct-test-password", 4));
  const auth = new AuthStore(sqlite);
  assert.equal(await auth.verify("editor@test.local", "wrong"), null);
  const user = await auth.verify("editor@test.local", "correct-test-password");
  assert.ok(user);
  const session = auth.createSession(user!.id);
  assert.equal(auth.resolve(session.id)?.email, "editor@test.local");
  auth.revoke(session.id);
  assert.equal(auth.resolve(session.id), null);
  const expired = auth.createSession(user!.id);
  sqlite
    .prepare("UPDATE sessions SET expires_at=? WHERE id=?")
    .run("2000-01-01", expired.id);
  assert.equal(auth.resolve(expired.id), null);
  sqlite.close();
});

it("reserves login attempts before asynchronous password checks", async () => {
  const { sqlite } = await openDatabase(":memory:");
  try {
    sqlite
      .prepare("INSERT INTO users(email,password_hash) VALUES(?,?)")
      .run("limited@test.local", await bcrypt.hash("test-password", 4));
    const auth = new AuthStore(sqlite);
    const pending = Array.from({ length: 8 }, () =>
      auth.verify("limited@test.local", "wrong"),
    );
    assert.equal(auth.throttled("limited@test.local"), true);
    assert.equal(
      await auth.verify("limited@test.local", "test-password"),
      null,
    );
    assert.deepEqual(await Promise.all(pending), Array(8).fill(null));
  } finally {
    sqlite.close();
  }
});
