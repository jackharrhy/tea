import { beforeEach, describe, expect, test } from "bun:test";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { mockClient } from "aws-sdk-client-mock";
import { eq } from "drizzle-orm";

import { createApplication } from "../src/http-app.ts";
import { schema } from "../src/db/index.ts";
import type { Config } from "../src/config.ts";
import { confirmSubscriber, createSubscriber } from "../src/services/subscriber.ts";
import { createTestDb, seedList } from "./helpers.ts";

const ses = mockClient(SESv2Client);
const config: Config = {
  awsRegion: "us-east-1",
  sqsQueueUrl: "unused",
  s3Bucket: "unused",
  dbPath: ":memory:",
  fromDomain: "example.com",
  baseUrl: "http://localhost:8080",
  sesConfigSet: "",
  s3MediaBucket: "unused",
  s3MediaBaseUrl: "",
  ownerEmail: "",
  ownerPassword: "",
  publicSubscriptionsEnabled: true,
};

beforeEach(() => ses.reset());

describe("Tea subscription route", () => {
  test("renders through Remix and rejects invalid input without writing or sending", async () => {
    const db = createTestDb();
    seedList(db);
    const app = createApplication(db, config);

    const page = await app.request("/subscribe");
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("Subscribe to a list");
    expect(html).not.toContain("hx-boost");

    const invalid = await app.request("/subscribe", {
      method: "POST",
      body: new URLSearchParams({ email: "invalid", lists: "test-list" }),
    });
    expect(invalid.status).toBe(400);
    expect(db.select().from(schema.subscribers).all()).toHaveLength(0);
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  test("persists the pending subscription and sends its confirmation", async () => {
    const db = createTestDb();
    seedList(db);
    ses.on(SendEmailCommand).resolves({ MessageId: "test-message" });
    const app = createApplication(db, config);

    const response = await app.request("/subscribe", {
      method: "POST",
      body: new URLSearchParams({
        email: "reader@example.com",
        lists: "test-list",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Check your email");
    const subscriber = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.email, "reader@example.com"))
      .get();
    expect(subscriber).toBeDefined();
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1);
  });

  test("leaves the membership unconfirmed when confirmation mail fails", async () => {
    const db = createTestDb();
    const list = seedList(db);
    ses.on(SendEmailCommand).rejects(new Error("mail unavailable"));
    const app = createApplication(db, config);

    const response = await app.request("/subscribe", {
      method: "POST",
      body: new URLSearchParams({
        email: "reader@example.com",
        lists: list.slug,
      }),
    });

    expect(response.status).toBeGreaterThanOrEqual(500);
    const memberships = db.select().from(schema.subscriberLists).all();
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.status).toBe("unconfirmed");
  });

  test("one-click unsubscribe changes only the addressed list", async () => {
    const db = createTestDb();
    const first = seedList(db, { slug: "first" });
    const second = seedList(db, { slug: "second" });
    const subscriber = createSubscriber(db, "reader@example.com", null, null, [
      first.slug,
      second.slug,
    ]);
    confirmSubscriber(db, subscriber.unsubscribeToken);
    const app = createApplication(db, config);

    const response = await app.request(`/unsubscribe/${subscriber.unsubscribeToken}/${first.id}`, {
      method: "POST",
      body: "List-Unsubscribe=One-Click",
    });

    expect(response.status).toBe(200);
    const memberships = db.select().from(schema.subscriberLists).all();
    expect(memberships.find((entry) => entry.listId === first.id)?.status).toBe("unsubscribed");
    expect(memberships.find((entry) => entry.listId === second.id)?.status).toBe("confirmed");
    expect(db.select().from(schema.subscribers).all()[0]?.status).toBe("active");
  });
});
