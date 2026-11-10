import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { schema } from "../src/db/index.ts";
import { createTeaExport } from "../src/migration/tea-export.ts";
import {
  createEmptyTeaDatabase,
  importTeaBundle,
} from "../src/migration/tea-import.ts";

test("imports domain IDs and unsubscribe links with explicit subjects, without old credentials", () => {
  const source = createEmptyTeaDatabase(":memory:");
  const old = drizzle(source, { schema });
  const user = old
    .insert(schema.users)
    .values({
      email: "owner@example.com",
      role: "owner",
      passwordHash: "old-hash",
    })
    .returning()
    .get();
  const list = old
    .insert(schema.lists)
    .values({
      slug: "news",
      name: "News",
      fromDomain: "example.com",
      fromAddress: "news@example.com",
    })
    .returning()
    .get();
  const subscriber = old
    .insert(schema.subscribers)
    .values({ email: "reader@example.com", unsubscribeToken: "keep-this-link" })
    .returning()
    .get();
  old
    .insert(schema.subscriberLists)
    .values({
      subscriberId: subscriber.id,
      listId: list.id,
      status: "confirmed",
    })
    .run();
  const exportBundle = createTeaExport(source);
  const destination = createEmptyTeaDatabase(":memory:");

  expect(() =>
    importTeaBundle(destination, exportBundle, { users: [] }),
  ).toThrow();
  expect(
    importTeaBundle(destination, exportBundle, {
      users: [{ id: user.id, subject: "central-subject-1" }],
    }),
  ).toMatchObject({ users: 1, lists: 1, subscribers: 1, subscriber_lists: 1 });
  const imported = drizzle(destination, { schema });
  expect(imported.select().from(schema.users).get()).toMatchObject({
    id: user.id,
    authSubject: "central-subject-1",
    passwordHash: "disabled:tea-migration",
  });
  expect(imported.select().from(schema.subscribers).get()).toMatchObject({
    id: subscriber.id,
    unsubscribeToken: "keep-this-link",
  });
  expect(imported.select().from(schema.subscriberLists).get()).toMatchObject({
    subscriberId: subscriber.id,
    listId: list.id,
  });
  expect(imported.select().from(schema.sessions).all()).toHaveLength(0);
  expect(imported.select().from(schema.apiTokens).all()).toHaveLength(0);
  expect(() =>
    importTeaBundle(destination, exportBundle, {
      users: [{ id: user.id, subject: "central-subject-1" }],
    }),
  ).toThrow("not empty");
  source.close();
  destination.close();
});

test("service account import requires an exact client binding", () => {
  const source = createEmptyTeaDatabase(":memory:");
  const old = drizzle(source, { schema });
  const user = old
    .insert(schema.users)
    .values({
      email: "integration@example.test",
      role: "member",
      passwordHash: "old-hash",
    })
    .returning()
    .get();
  const bundle = createTeaExport(source);
  const destination = createEmptyTeaDatabase(":memory:");
  expect(() =>
    importTeaBundle(destination, bundle, {
      users: [
        { id: user.id, subject: "service-subject", principalType: "service" },
      ],
    }),
  ).toThrow("Invalid user subject mapping");
  importTeaBundle(destination, bundle, {
    users: [
      {
        id: user.id,
        subject: "service-subject",
        principalType: "service",
        clientId: "exact-client",
      },
    ],
  });
  expect(
    drizzle(destination, { schema }).select().from(schema.users).get(),
  ).toMatchObject({
    id: user.id,
    authSubject: "service-subject",
    authPrincipalType: "service",
    authClientId: "exact-client",
    passwordHash: "disabled:tea-migration",
  });
  source.close();
  destination.close();
});
