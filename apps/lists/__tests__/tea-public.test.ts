import { expect, test } from "bun:test";

import { createApplication } from "../src/http-app.ts";
import type { Config } from "../src/config.ts";
import {
  confirmSubscriber,
  createSubscriber,
  getSubscriberPreferences,
} from "../src/services/subscriber.ts";
import { createTestDb, seedList } from "./helpers.ts";

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

test("Remix confirmation, preferences, and unsubscribe keep existing public link behavior", async () => {
  const db = createTestDb();
  const first = seedList(db, { slug: "first" });
  const second = seedList(db, { slug: "second" });
  const subscriber = createSubscriber(db, "reader@example.com", null, null, [
    "first",
    "second",
  ]);
  const app = createApplication(db, config);
  const token = subscriber.unsubscribeToken;

  const subscribe = await app.request("/subscribe");
  expect(subscribe.headers.get("Cache-Control")).toBe("private, no-store");
  const policy = subscribe.headers.get("Content-Security-Policy") ?? "";
  expect(policy).toMatch(/style-src 'self' 'nonce-[^']+'/);
  expect(policy).not.toContain("unsafe-eval");

  const confirm = await app.request(`/confirm/${token}/example.com`);
  expect(confirm.status).toBe(200);
  expect(await confirm.text()).toContain("Confirmed");

  const preferences = await app.request(`/preferences/${token}`);
  expect(preferences.status).toBe(200);
  const html = await preferences.text();
  expect(html).toContain("reader@example.com");
  expect(html).not.toContain("hx-boost");

  const oneClick = await app.request(`/unsubscribe/${token}/${first.id}`, {
    method: "POST",
  });
  expect(oneClick.status).toBe(200);
  expect(await oneClick.text()).toBe("Unsubscribed");
  expect(
    getSubscriberPreferences(db, token)?.lists.find(
      (list) => list.id === first.id,
    )?.subscriptionStatus,
  ).toBe("unsubscribed");
  expect(
    getSubscriberPreferences(db, token)?.lists.find(
      (list) => list.id === second.id,
    )?.subscriptionStatus,
  ).toBe("confirmed");

  const invalid = await app.request("/preferences/invalid-token");
  expect(invalid.status).toBe(400);
  expect(await invalid.text()).toContain("Invalid link");
  expect(confirmSubscriber(db, token)).toBe(true);
});
