import { configureIdentityEnvironment } from "./identity-fixture.ts";
import { sessions, users } from "#db";
import { setDbForTesting } from "#db/connection.server";

import { router } from "../app/router.ts";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "./db.ts";

const origin = "http://artbin.test";
export const adminCookie = "artbin_session=admin-session";
export const memberCookie = "artbin_session=member-session";

export type RouterHarness = {
  database: TestDatabase;
  request(path: string, cookie?: string, init?: RequestInit): Request;
  close(): void;
};

export async function createRouterHarness(): Promise<RouterHarness> {
  const restoreIdentity = configureIdentityEnvironment();
  process.env.NODE_ENV = "test";
  process.env.ARTBIN_REQUIRE_AUTH = "1";

  const database = createTestDatabase();
  applyMigrations(database.sqlite);
  setDbForTesting(database.db);
  await database.db.insert(users).values([
    {
      id: "admin",
      username: "admin",
      authSubject: "central-admin",
      isAdmin: true,
    },
    {
      id: "member",
      username: "member",
      authSubject: "central-member",
      isAdmin: false,
    },
  ]);
  await database.db.insert(sessions).values([
    {
      id: "admin-session",
      userId: "admin",
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      id: "member-session",
      userId: "member",
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]);

  return {
    database,
    request(path, cookie, init = {}) {
      const headers = new Headers(init.headers);
      if (cookie) headers.set("Cookie", cookie);
      return new Request(new URL(path, origin), { ...init, headers });
    },
    close() {
      restoreIdentity();
      database.close();
    },
  };
}

export { router };
