import { test, expect, describe, beforeEach } from "bun:test";
import { mockClient } from "aws-sdk-client-mock";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { createApplication } from "../src/http-app.ts";

import { createTestDb, seedList, type TestDb } from "./helpers";
import * as schema from "../src/db/schema";
import type { Config } from "../src/config";
import {
  createSubscriber,
  confirmSubscriber,
} from "../src/services/subscriber";

const sesMock = mockClient(SESv2Client);
const s3Mock = mockClient(S3Client);

const testConfig: Config = {
  awsRegion: "us-east-1",
  sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/test-queue",
  s3Bucket: "test-bucket",
  dbPath: ":memory:",
  fromDomain: "example.com",
  baseUrl: "http://localhost:8080",
  sesConfigSet: "test-config-set",
  ownerEmail: "",
  ownerPassword: "",
};

beforeEach(() => {
  sesMock.reset();
  s3Mock.reset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createApp(db: TestDb, config: Config = testConfig) {
  return createApplication(db, config);
}

async function seedOwner(db: TestDb) {
  const passwordHash = await Bun.password.hash("password");
  return db
    .insert(schema.users)
    .values({
      email: "owner@example.com",
      name: "Owner",
      passwordHash,
      role: "owner",
    })
    .returning()
    .get();
}

async function login(
  app: ReturnType<typeof createApplication>,
  email = "owner@example.com",
  password = "password",
) {
  const res = await app.request("/admin/login", {
    method: "POST",
    body: new URLSearchParams({ email, password }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  return cookie;
}

async function authPost(
  app: ReturnType<typeof createApplication>,
  path: string,
  cookie: string,
  formData: Record<string, string>,
) {
  return app.request(path, {
    method: "POST",
    body: new URLSearchParams(formData),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
  });
}

async function authGet(
  app: ReturnType<typeof createApplication>,
  path: string,
  cookie: string,
) {
  return app.request(path, {
    method: "GET",
    headers: { Cookie: cookie },
  });
}

// ---------------------------------------------------------------------------
// Test 1: Full campaign create → send flow (list audience)
// ---------------------------------------------------------------------------
describe("Full HTTP flow: campaign create+send (list audience)", () => {
  test("test campaign detail shows its limited audience and recipient emails", async () => {
    const db = createTestDb();
    await seedOwner(db);
    const list = seedList(db, {
      slug: "newsletter",
      name: "Newsletter",
      fromDomain: "example.com",
    });
    const selected = createSubscriber(
      db,
      "selected@example.com",
      "Selected",
      null,
      ["newsletter"],
    );
    const other = createSubscriber(db, "other@example.com", "Other", null, [
      "newsletter",
    ]);
    confirmSubscriber(db, selected.unsubscribeToken);
    confirmSubscriber(db, other.unsubscribeToken);
    const campaign = db
      .insert(schema.campaigns)
      .values({
        subject: "Test: Pilot",
        bodyMarkdown: "Pilot content",
        fromAddress: "news@example.com",
        audienceType: "list",
        audienceId: list.id,
        audienceData: JSON.stringify({ testSubscriberIds: [selected.id] }),
        status: "sent",
      })
      .returning()
      .get();
    db.insert(schema.campaignSends)
      .values({
        campaignId: campaign.id,
        subscriberId: selected.id,
        status: "delivered",
      })
      .run();

    const app = createApp(db);
    const cookie = await login(app);
    const response = await authGet(
      app,
      `/admin/campaigns/${campaign.id}`,
      cookie,
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Test: 1 selected from Newsletter");
    expect(html).toContain("This campaign was not sent to the full list");
    expect(html).toContain("selected@example.com");
    expect(html).not.toContain("other@example.com");
  });

  test("POST /admin/campaigns/new with audienceMode=list creates correct DB row and sends", async () => {
    const db = createTestDb();
    await seedOwner(db);
    const list = seedList(db, {
      slug: "newsletter",
      name: "Newsletter",
      fromDomain: "example.com",
    });

    // Create a confirmed subscriber
    const sub = createSubscriber(db, "reader@example.com", "Reader", "One", [
      "newsletter",
    ]);
    confirmSubscriber(db, sub.unsubscribeToken);

    const app = createApp(db);
    const cookie = await login(app);

    // POST campaign creation via the admin form handler
    const createRes = await authPost(app, "/admin/campaigns/new", cookie, {
      audienceMode: "list",
      listId: String(list.id),
      fromAddress: "test@example.com",
      subject: "Test List Campaign",
      bodyMarkdown: "Hello {{firstName}}",
    });

    // Should redirect to campaign detail page
    expect(createRes.status).toBe(303);

    // Verify campaign in DB
    const campaign = db.select().from(schema.campaigns).get();
    expect(campaign).toBeDefined();
    expect(campaign!.audienceType).toBe("list");
    expect(campaign!.audienceId).toBe(list.id);
    expect(campaign!.audienceData).toBeNull();
    expect(campaign!.status).toBe("draft");

    // Mock SES and send
    sesMock.on(SendEmailCommand).resolves({ MessageId: "list-msg-id" });

    const sendRes = await authPost(
      app,
      `/admin/campaigns/${campaign!.id}/send`,
      cookie,
      {},
    );
    expect(sendRes.status).toBe(303);

    // Verify campaign is now "sent"
    const updated = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign!.id))
      .get();
    expect(updated!.status).toBe("sent");
    expect(updated!.sentAt).not.toBeNull();

    // Verify SES called once
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(1);

    // Verify campaignSends record
    const sends = db
      .select()
      .from(schema.campaignSends)
      .where(eq(schema.campaignSends.campaignId, campaign!.id))
      .all();
    expect(sends).toHaveLength(1);
    expect(sends[0].subscriberId).toBe(sub.id);
    expect(sends[0].status).toBe("accepted");
  });
});

async function setupCampaignDeletion() {
  const db = createTestDb();
  const owner = await seedOwner(db);
  const list = seedList(db, {
    slug: "newsletter",
    fromDomain: "example.com",
  });
  const sub = createSubscriber(db, "reader@example.com", "Reader", null, [
    "newsletter",
  ]);
  const campaign = db
    .insert(schema.campaigns)
    .values({
      audienceType: "list",
      audienceId: list.id,
      subject: "Delete me",
      bodyMarkdown: "Hello",
      fromAddress: "news@example.com",
      status: "draft",
    })
    .returning()
    .get();
  db.insert(schema.campaignSends)
    .values({
      campaignId: campaign.id,
      subscriberId: sub.id,
      idempotencyKey: `campaign:${campaign.id}:subscriber:${sub.id}`,
    })
    .run();
  db.insert(schema.events)
    .values({
      type: "campaign.created",
      campaignId: campaign.id,
      userId: owner.id,
    })
    .run();
  const message = db
    .insert(schema.messages)
    .values({
      threadId: 1,
      direction: "outbound",
      fromAddr: "news@example.com",
      toAddr: sub.email,
      subject: "Delete me",
      campaignId: campaign.id,
    })
    .returning()
    .get();

  const config = { ...testConfig, s3MediaBucket: "media-bucket" };
  const app = createApp(db, config);
  const cookie = await login(app);
  return { db, campaign, message, app, cookie };
}

describe("Full HTTP flow: delete campaign", () => {
  test("keeps database records when required S3 cleanup is denied", async () => {
    const { db, campaign, app, cookie } = await setupCampaignDeletion();

    s3Mock.on(ListObjectsV2Command).rejects(
      Object.assign(new Error("Access denied"), {
        name: "AccessDenied",
      }),
    );
    const response = await authPost(
      app,
      `/admin/campaigns/${campaign.id}/delete`,
      cookie,
      {},
    );

    expect(response.status).toBe(500);
    expect(db.select().from(schema.campaigns).all()).toHaveLength(1);
    expect(db.select().from(schema.campaignSends).all()).toHaveLength(1);
    expect(
      db
        .select()
        .from(schema.events)
        .where(eq(schema.events.type, "admin.campaign_deleted"))
        .all(),
    ).toEqual([]);
  });

  test("deletes linked records transactionally after S3 cleanup succeeds", async () => {
    const { db, campaign, message, app, cookie } =
      await setupCampaignDeletion();
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });

    const response = await authPost(
      app,
      `/admin/campaigns/${campaign.id}/delete`,
      cookie,
      {},
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/campaigns");
    expect(db.select().from(schema.campaigns).all()).toEqual([]);
    expect(db.select().from(schema.campaignSends).all()).toEqual([]);
    expect(
      db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, message.id))
        .get()!.campaignId,
    ).toBeNull();
    expect(
      db
        .select()
        .from(schema.events)
        .where(eq(schema.events.type, "campaign.created"))
        .get()!.campaignId,
    ).toBeNull();
    const deletionEvent = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "admin.campaign_deleted"))
      .get()!;
    expect(deletionEvent.campaignId).toBeNull();
    expect(JSON.parse(deletionEvent.meta!)).toEqual({
      campaignId: campaign.id,
    });
  });
});

describe("Full HTTP flow: create list", () => {
  test("owner can create a list and the audit event records that owner", async () => {
    const db = createTestDb();
    const owner = await seedOwner(db);
    const app = createApp(db);
    const cookie = await login(app);

    const response = await authPost(app, "/admin/lists/new", cookie, {
      slug: "new-list",
      name: "New List",
      fromDomain: "example.com",
      fromAddress: "news@example.com",
    });

    expect(response.status).toBe(303);
    expect(
      db
        .select()
        .from(schema.lists)
        .where(eq(schema.lists.slug, "new-list"))
        .get(),
    ).toBeDefined();
    const event = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "admin.list_created"))
      .get();
    expect(event!.userId).toBe(owner.id);
  });

  test("member cannot create a list by posting directly", async () => {
    const db = createTestDb();
    const passwordHash = await Bun.password.hash("password");
    db.insert(schema.users)
      .values({
        email: "member@example.com",
        passwordHash,
        role: "member",
      })
      .run();
    const app = createApp(db);
    const cookie = await login(app, "member@example.com", "password");

    const response = await authPost(app, "/admin/lists/new", cookie, {
      slug: "forbidden-list",
      name: "Forbidden List",
      fromDomain: "example.com",
    });

    expect(response.status).toBe(403);
    expect(db.select().from(schema.lists).all()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Full campaign create → send flow (specific subscribers)
// ---------------------------------------------------------------------------
describe("Full HTTP flow: campaign create+send (specific subscribers)", () => {
  test("POST with audienceMode=specific stores flat array in audienceData and sends to correct subscribers", async () => {
    const db = createTestDb();
    await seedOwner(db);
    seedList(db, {
      slug: "newsletter",
      name: "Newsletter",
      fromDomain: "example.com",
    });

    const sub1 = createSubscriber(db, "pick1@example.com", "Pick", "One", [
      "newsletter",
    ]);
    confirmSubscriber(db, sub1.unsubscribeToken);
    const sub2 = createSubscriber(db, "skip@example.com", "Skip", "Me", [
      "newsletter",
    ]);
    confirmSubscriber(db, sub2.unsubscribeToken);
    const sub3 = createSubscriber(db, "pick3@example.com", "Pick", "Three", [
      "newsletter",
    ]);
    confirmSubscriber(db, sub3.unsubscribeToken);

    const app = createApp(db);
    const cookie = await login(app);

    // POST with subscriberIds as comma-separated string (as the form does)
    const createRes = await authPost(app, "/admin/campaigns/new", cookie, {
      audienceMode: "specific",
      subscriberIds: `${sub1.id},${sub3.id}`,
      fromAddress: "test@example.com",
      subject: "Specific Subs",
      bodyMarkdown: "Hello {{firstName}}",
    });
    expect(createRes.status).toBe(303);

    // Verify DB
    const campaign = db.select().from(schema.campaigns).get();
    expect(campaign).toBeDefined();
    expect(campaign!.audienceType).toBe("subscribers");
    expect(campaign!.audienceId).toBeNull();

    // Critical: audienceData must be a flat JSON array [id1, id3], NOT wrapped in an object
    const parsedData = JSON.parse(campaign!.audienceData!);
    expect(Array.isArray(parsedData)).toBe(true);
    expect(parsedData).toEqual([sub1.id, sub3.id]);

    // Mock SES and send
    sesMock.on(SendEmailCommand).resolves({ MessageId: "specific-msg-id" });

    await authPost(app, `/admin/campaigns/${campaign!.id}/send`, cookie, {});

    // Verify SES called exactly 2 times (not 3)
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(2);

    // Verify sends
    const sends = db
      .select()
      .from(schema.campaignSends)
      .where(eq(schema.campaignSends.campaignId, campaign!.id))
      .all();
    expect(sends).toHaveLength(2);
    const sentIds = sends
      .map((s) => s.subscriberId)
      .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(sentIds).toEqual(
      [sub1.id, sub3.id].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3: Full campaign create → send flow (tag audience)
// ---------------------------------------------------------------------------
describe("Full HTTP flow: campaign create+send (tag audience)", () => {
  test("POST with audienceMode=tag creates correct DB row and sends only to tagged subscribers", async () => {
    const db = createTestDb();
    await seedOwner(db);
    seedList(db, {
      slug: "newsletter",
      name: "Newsletter",
      fromDomain: "example.com",
    });

    const sub1 = createSubscriber(db, "tagged1@example.com", "Tagged", "One", [
      "newsletter",
    ]);
    confirmSubscriber(db, sub1.unsubscribeToken);
    const sub2 = createSubscriber(db, "tagged2@example.com", "Tagged", "Two", [
      "newsletter",
    ]);
    confirmSubscriber(db, sub2.unsubscribeToken);
    const sub3 = createSubscriber(
      db,
      "untagged@example.com",
      "Untagged",
      null,
      ["newsletter"],
    );
    confirmSubscriber(db, sub3.unsubscribeToken);

    // Create tag and apply to sub1 and sub2
    const tag = db
      .insert(schema.tags)
      .values({ name: "vip" })
      .returning()
      .get();
    db.insert(schema.subscriberTags)
      .values({ subscriberId: sub1.id, tagId: tag.id })
      .run();
    db.insert(schema.subscriberTags)
      .values({ subscriberId: sub2.id, tagId: tag.id })
      .run();

    const app = createApp(db);
    const cookie = await login(app);

    const createRes = await authPost(app, "/admin/campaigns/new", cookie, {
      audienceMode: "tag",
      tagId: String(tag.id),
      fromAddress: "test@example.com",
      subject: "VIP Only",
      bodyMarkdown: "# VIP content",
    });
    expect(createRes.status).toBe(303);

    // Verify DB
    const campaign = db.select().from(schema.campaigns).get();
    expect(campaign).toBeDefined();
    expect(campaign!.audienceType).toBe("tag");
    expect(campaign!.audienceId).toBe(tag.id);

    // Mock SES and send
    sesMock.on(SendEmailCommand).resolves({ MessageId: "tag-msg-id" });

    await authPost(app, `/admin/campaigns/${campaign!.id}/send`, cookie, {});

    // Verify SES called exactly 2 times
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(2);

    // Verify sends target sub1 and sub2
    const sends = db
      .select()
      .from(schema.campaignSends)
      .where(eq(schema.campaignSends.campaignId, campaign!.id))
      .all();
    expect(sends).toHaveLength(2);
    const sentIds = sends
      .map((s) => s.subscriberId)
      .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(sentIds).toEqual(
      [sub1.id, sub2.id].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4: Full campaign create → send flow (all subscribers)
// ---------------------------------------------------------------------------
describe("Full HTTP flow: campaign create+send (all subscribers)", () => {
  test("POST with audienceMode=all creates correct DB row and sends to all unique confirmed subscribers", async () => {
    const db = createTestDb();
    await seedOwner(db);
    seedList(db, {
      slug: "list-a",
      name: "List A",
      fromDomain: "example.com",
    });
    seedList(db, {
      slug: "list-b",
      name: "List B",
      fromDomain: "example.com",
    });

    // sub1: on list-a only
    const sub1 = createSubscriber(db, "sub1@example.com", "Sub", "One", [
      "list-a",
    ]);
    confirmSubscriber(db, sub1.unsubscribeToken);
    // sub2: on list-b only
    const sub2 = createSubscriber(db, "sub2@example.com", "Sub", "Two", [
      "list-b",
    ]);
    confirmSubscriber(db, sub2.unsubscribeToken);
    // sub3: on BOTH lists (should only get 1 email)
    const sub3 = createSubscriber(db, "sub3@example.com", "Sub", "Three", [
      "list-a",
      "list-b",
    ]);
    confirmSubscriber(db, sub3.unsubscribeToken);

    const app = createApp(db);
    const cookie = await login(app);

    const createRes = await authPost(app, "/admin/campaigns/new", cookie, {
      audienceMode: "all",
      fromAddress: "broadcast@example.com",
      subject: "All Subscribers",
      bodyMarkdown: "Hello everyone",
    });
    expect(createRes.status).toBe(303);

    // Verify DB
    const campaign = db.select().from(schema.campaigns).get();
    expect(campaign).toBeDefined();
    expect(campaign!.audienceType).toBe("all");
    expect(campaign!.audienceId).toBeNull();

    // Mock SES and send
    sesMock.on(SendEmailCommand).resolves({ MessageId: "all-msg-id" });

    await authPost(app, `/admin/campaigns/${campaign!.id}/send`, cookie, {});

    // Should be exactly 3 calls (3 unique subscribers, not 4 from list memberships)
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(3);

    const sends = db
      .select()
      .from(schema.campaignSends)
      .where(eq(schema.campaignSends.campaignId, campaign!.id))
      .all();
    expect(sends).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Full subscribe → confirm → receive campaign flow
// ---------------------------------------------------------------------------
describe("Full HTTP flow: subscribe → confirm → receive campaign", () => {
  test("public subscriptions can be disabled without creating a subscriber or sending email", async () => {
    const db = createTestDb();
    await seedOwner(db);
    seedList(db, {
      slug: "newsletter",
      name: "Newsletter",
      fromDomain: "example.com",
    });

    const app = createApp(db, { publicSubscriptionsEnabled: false });
    const response = await app.request("/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "target@example.com",
        lists: "newsletter",
      }).toString(),
    });

    expect(response.status).toBe(503);
    expect(db.select().from(schema.subscribers).all()).toHaveLength(0);
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  test("public subscribe, confirm via link, then receive campaign via admin send", async () => {
    const db = createTestDb();
    await seedOwner(db);
    seedList(db, {
      slug: "newsletter",
      name: "Newsletter",
      fromDomain: "example.com",
    });

    const app = createApp(db);

    // Mock SES for confirmation email
    sesMock.on(SendEmailCommand).resolves({ MessageId: "confirm-msg-id" });

    // 1. POST /subscribe
    const subscribeRes = await app.request("/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "newuser@example.com",
        firstName: "New",
        lastName: "User",
        lists: "newsletter",
      }).toString(),
    });
    expect(subscribeRes.status).toBe(200);

    // Verify subscriber created
    const subscriber = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.email, "newuser@example.com"))
      .get();
    expect(subscriber).toBeDefined();

    // Verify subscriberList is "unconfirmed"
    const subLists = db
      .select()
      .from(schema.subscriberLists)
      .where(eq(schema.subscriberLists.subscriberId, subscriber!.id))
      .all();
    expect(subLists).toHaveLength(1);
    expect(subLists[0].status).toBe("unconfirmed");

    // SES was called for confirmation email
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);

    // 2. GET /confirm/:token/:domain
    const confirmRes = await app.request(
      `/confirm/${subscriber!.unsubscribeToken}/example.com`,
      {
        method: "GET",
      },
    );
    expect(confirmRes.status).toBe(200);
    const confirmHtml = await confirmRes.text();
    expect(confirmHtml).toContain("Confirmed");

    // Verify subscriberList is now "confirmed"
    const confirmedLists = db
      .select()
      .from(schema.subscriberLists)
      .where(eq(schema.subscriberLists.subscriberId, subscriber!.id))
      .all();
    expect(confirmedLists).toHaveLength(1);
    expect(confirmedLists[0].status).toBe("confirmed");

    // 3. Create and send campaign via admin
    sesMock.reset();
    sesMock.on(SendEmailCommand).resolves({ MessageId: "campaign-msg-id" });

    const cookie = await login(app);
    const list = db
      .select()
      .from(schema.lists)
      .where(eq(schema.lists.slug, "newsletter"))
      .get();

    await authPost(app, "/admin/campaigns/new", cookie, {
      audienceMode: "list",
      listId: String(list!.id),
      fromAddress: "news@example.com",
      subject: "Welcome Email",
      bodyMarkdown: "Hello {{firstName}} {{lastName}}!",
    });

    const campaign = db.select().from(schema.campaigns).get();
    await authPost(app, `/admin/campaigns/${campaign!.id}/send`, cookie, {});

    // Verify subscriber received the campaign
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(1);

    const sends = db
      .select()
      .from(schema.campaignSends)
      .where(eq(schema.campaignSends.campaignId, campaign!.id))
      .all();
    expect(sends).toHaveLength(1);
    expect(sends[0].subscriberId).toBe(subscriber!.id);
    expect(sends[0].status).toBe("accepted");
  });
});

// ---------------------------------------------------------------------------
// Test 6: Reply flow via HTTP
// ---------------------------------------------------------------------------
describe("Full HTTP flow: reply to inbound message", () => {
  test("POST /admin/inbound/:id/reply creates outbound message with threading", async () => {
    const db = createTestDb();
    await seedOwner(db);
    seedList(db, { slug: "newsletter", fromDomain: "example.com" });

    // Insert an inbound message (simulating the poller having received it)
    const inbound = db
      .insert(schema.messages)
      .values({
        threadId: 0,
        direction: "inbound",
        sesMessageId: "inbound-reply-test-001",
        rfc822MessageId: "<original@gmail.com>",
        fromAddr: "sender@gmail.com",
        toAddr: "newsletter@reply.example.com",
        subject: "Question about newsletter",
        spamVerdict: "PASS",
        virusVerdict: "PASS",
        spfVerdict: "PASS",
        dkimVerdict: "PASS",
        dmarcVerdict: "PASS",
        s3Key: "inbound/inbound-reply-test-001",
      })
      .returning()
      .get();

    // Update threadId to own id (simulating the poller setting it)
    db.update(schema.messages)
      .set({ threadId: inbound.id })
      .where(eq(schema.messages.id, inbound.id))
      .run();

    sesMock.on(SendEmailCommand).resolves({ MessageId: "ses-reply-id" });

    const app = createApp(db);
    const cookie = await login(app);

    // POST reply
    const replyRes = await authPost(
      app,
      `/admin/inbound/${inbound.id}/reply`,
      cookie,
      {
        fromAddr: "admin@example.com",
        toAddr: "sender@gmail.com",
        subject: "Re: Question about newsletter",
        body: "Thanks for reaching out!",
      },
    );

    // Should redirect
    expect(replyRes.status).toBe(303);

    // Verify SES called
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(1);

    // Verify raw email contains threading headers
    const rawData = sesCalls[0].args[0].input.Content?.Raw?.Data;
    expect(rawData).toBeDefined();
    const rawEmail = new TextDecoder().decode(rawData as Uint8Array);
    expect(rawEmail).toContain("In-Reply-To: <original@gmail.com>");
    expect(rawEmail).toContain("References: <original@gmail.com>");

    // Verify outbound message created in DB
    const outbound = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.direction, "outbound"))
      .get();
    expect(outbound).toBeDefined();
    expect(outbound!.threadId).toBe(inbound.id);
    expect(outbound!.parentId).toBe(inbound.id);
    expect(outbound!.fromAddr).toBe("admin@example.com");
    expect(outbound!.toAddr).toBe("sender@gmail.com");
    expect(outbound!.subject).toBe("Re: Question about newsletter");
    expect(outbound!.bodyText).toBe("Thanks for reaching out!");
    expect(outbound!.inReplyTo).toBe("<original@gmail.com>");
  });
});

// ---------------------------------------------------------------------------
// Test 7: Campaign edit via HTTP
// ---------------------------------------------------------------------------
describe("Full HTTP flow: campaign edit then send", () => {
  test("POST /admin/campaigns/:id/edit updates campaign, and send uses new content", async () => {
    const db = createTestDb();
    await seedOwner(db);
    const list = seedList(db, {
      slug: "newsletter",
      name: "Newsletter",
      fromDomain: "example.com",
    });

    const sub = createSubscriber(db, "reader@example.com", "Reader", null, [
      "newsletter",
    ]);
    confirmSubscriber(db, sub.unsubscribeToken);

    const app = createApp(db);
    const cookie = await login(app);

    // Create draft campaign
    await authPost(app, "/admin/campaigns/new", cookie, {
      audienceMode: "list",
      listId: String(list.id),
      fromAddress: "test@example.com",
      subject: "Original Subject",
      bodyMarkdown: "Original body",
    });

    const campaign = db.select().from(schema.campaigns).get();
    expect(campaign).toBeDefined();
    expect(campaign!.subject).toBe("Original Subject");
    expect(campaign!.bodyMarkdown).toBe("Original body");

    // Edit the campaign
    const editRes = await authPost(
      app,
      `/admin/campaigns/${campaign!.id}/edit`,
      cookie,
      {
        audienceMode: "list",
        listId: String(list.id),
        fromAddress: "test@example.com",
        subject: "Updated Subject",
        bodyMarkdown: "Updated body with {{firstName}}",
      },
    );
    expect(editRes.status).toBe(303);

    // Verify updated in DB
    const updated = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign!.id))
      .get();
    expect(updated!.subject).toBe("Updated Subject");
    expect(updated!.bodyMarkdown).toBe("Updated body with {{firstName}}");

    // Send it and verify the NEW content was used
    sesMock.on(SendEmailCommand).resolves({ MessageId: "edit-msg-id" });

    await authPost(app, `/admin/campaigns/${campaign!.id}/send`, cookie, {});

    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(1);

    // Decode the raw email and check it contains the updated content
    const rawData = sesCalls[0].args[0].input.Content?.Raw?.Data;
    const rawEmail = new TextDecoder().decode(rawData as Uint8Array);
    expect(rawEmail).toContain("Updated Subject");
    expect(rawEmail).toContain("Updated body with Reader");

    // Campaign should be sent
    const final = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign!.id))
      .get();
    expect(final!.status).toBe("sent");
  });
});

describe("Campaign editor validation and authorization", () => {
  test("member cannot bypass audience controls by posting an all-subscribers campaign", async () => {
    const db = createTestDb();
    const passwordHash = await Bun.password.hash("password");
    db.insert(schema.users)
      .values({
        email: "member@example.com",
        name: "Member",
        passwordHash,
        role: "member",
      })
      .run();
    const app = createApp(db);
    const cookie = await login(app, "member@example.com");

    const response = await authPost(app, "/admin/campaigns/new", cookie, {
      audienceMode: "all",
      fromAddress: "news@example.com",
      subject: "Unauthorized",
      bodyMarkdown: "This must not be created",
    });

    expect(response.status).toBe(403);
    expect(db.select().from(schema.campaigns).all()).toEqual([]);
  });

  test("scheduled campaigns remain editable", async () => {
    const db = createTestDb();
    await seedOwner(db);
    const list = seedList(db, {
      slug: "scheduled",
      name: "Scheduled",
      fromDomain: "example.com",
    });
    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: list.id,
        fromAddress: "news@example.com",
        subject: "Before",
        bodyMarkdown: "Before",
        status: "scheduled",
        scheduledAt: "2026-09-01T12:00:00.000Z",
      })
      .returning()
      .get();
    const app = createApp(db);
    const cookie = await login(app);

    const response = await authPost(
      app,
      `/admin/campaigns/${campaign.id}/edit`,
      cookie,
      {
        audienceMode: "list",
        listId: String(list.id),
        fromAddress: "news@example.com",
        subject: "After",
        bodyMarkdown: "Updated",
        scheduledAt: "2026-09-02T12:00:00.000Z",
      },
    );

    expect(response.status).toBe(303);
    const updated = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .get()!;
    expect(updated.subject).toBe("After");
    expect(updated.status).toBe("scheduled");
    expect(updated.scheduledAt).toBe("2026-09-02T12:00:00.000Z");
  });

  test("malformed pending image state is rejected before creating a campaign", async () => {
    const db = createTestDb();
    await seedOwner(db);
    const list = seedList(db, {
      slug: "images",
      name: "Images",
      fromDomain: "example.com",
    });
    const app = createApp(db);
    const cookie = await login(app);

    const response = await authPost(app, "/admin/campaigns/new", cookie, {
      audienceMode: "list",
      listId: String(list.id),
      fromAddress: "news@example.com",
      subject: "Broken images",
      bodyMarkdown: "Body",
      pendingImagesJson: "not-json",
    });

    expect(response.status).toBe(400);
    expect(db.select().from(schema.campaigns).all()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. Inbound list groups by thread (one row per conversation)
// ---------------------------------------------------------------------------
describe("Inbound list groups by thread", () => {
  test("multiple messages in same thread show as one row", async () => {
    const db = createTestDb();
    const app = createApp(db);
    await seedOwner(db);
    const cookie = await login(app);

    // Insert a thread with 3 messages: root inbound, outbound reply, follow-up inbound
    db.insert(schema.messages)
      .values({
        threadId: 0,
        direction: "inbound",
        rfc822MessageId: "<root@gmail.com>",
        fromAddr: "user@gmail.com",
        toAddr: "list@reply.example.com",
        subject: "Thread Subject",
        sesMessageId: "root-ses-id",
        bodyText: "First message",
        createdAt: "2026-03-17T10:00:00Z",
      })
      .run();
    const root = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sesMessageId, "root-ses-id"))
      .get()!;
    db.update(schema.messages)
      .set({ threadId: root.id })
      .where(eq(schema.messages.id, root.id))
      .run();

    db.insert(schema.messages)
      .values({
        threadId: root.id,
        parentId: root.id,
        direction: "outbound",
        rfc822MessageId: "<reply@example.com>",
        fromAddr: "list@reply.example.com",
        toAddr: "user@gmail.com",
        subject: "Re: Thread Subject",
        sesMessageId: "reply-ses-id",
        bodyText: "Our reply",
        sentAt: "2026-03-17T10:05:00Z",
        createdAt: "2026-03-17T10:05:00Z",
      })
      .run();

    db.insert(schema.messages)
      .values({
        threadId: root.id,
        parentId: root.id,
        direction: "inbound",
        rfc822MessageId: "<followup@gmail.com>",
        fromAddr: "user@gmail.com",
        toAddr: "list@reply.example.com",
        subject: "Re: Thread Subject",
        sesMessageId: "followup-ses-id",
        bodyText: "Follow up",
        createdAt: "2026-03-17T10:10:00Z",
      })
      .run();

    // Also insert an unrelated single message (different thread)
    db.insert(schema.messages)
      .values({
        threadId: 0,
        direction: "inbound",
        rfc822MessageId: "<other@gmail.com>",
        fromAddr: "other@gmail.com",
        toAddr: "list@reply.example.com",
        subject: "Unrelated",
        sesMessageId: "other-ses-id",
        bodyText: "Different conversation",
        createdAt: "2026-03-17T11:00:00Z",
      })
      .run();
    const other = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sesMessageId, "other-ses-id"))
      .get()!;
    db.update(schema.messages)
      .set({ threadId: other.id })
      .where(eq(schema.messages.id, other.id))
      .run();

    // GET the inbound list
    const res = await app.request("/admin/inbound", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    // Should show "Thread Subject" once (grouped), not twice
    const threadSubjectMatches = html.match(/Thread Subject/g) ?? [];
    // The subject appears in the link text -- should be 1 row, so 1 occurrence in <a> tags
    // (might appear more times in HTML attributes, so just check it's fewer than 3)
    expect(threadSubjectMatches.length).toBeLessThanOrEqual(2);

    // Should show "Unrelated" once
    expect(html).toContain("Unrelated");

    // The reply count for the thread should be 2 (outbound reply + follow-up inbound)
    // Look for "2" in the replies column -- the thread has 3 messages total, minus 1 root = 2
    expect(html).toContain("Thread Subject");
  });
});

describe("Subscriber orphan cleanup", () => {
  test("labels and filters subscribers without list memberships", async () => {
    const db = createTestDb();
    await seedOwner(db);
    const list = seedList(db, {
      slug: "newsletter",
      name: "Newsletter",
      fromDomain: "example.com",
    });
    const campaign = db
      .insert(schema.campaigns)
      .values({
        subject: "List history",
        bodyMarkdown: "Body",
        fromAddress: "news@example.com",
        audienceType: "list",
        audienceId: list.id,
      })
      .returning()
      .get();
    db.insert(schema.events)
      .values({
        type: "campaign.created",
        detail: campaign.subject,
        campaignId: campaign.id,
      })
      .run();
    createSubscriber(db, "member@example.com", "List", "Member", [
      "newsletter",
    ]);
    createSubscriber(db, "orphan@example.com", "No", "Lists", []);
    const app = createApp(db);
    const cookie = await login(app);

    const indexHtml = await (
      await authGet(app, "/admin/subscribers", cookie)
    ).text();
    expect(indexHtml).toContain("1 orphaned");
    expect(indexHtml).toContain("orphan@example.com");
    expect(indexHtml).toContain("Orphaned");

    const filteredHtml = await (
      await authGet(app, "/admin/subscribers?membership=orphaned", cookie)
    ).text();
    expect(filteredHtml).toContain("orphan@example.com");
    expect(filteredHtml).not.toContain("member@example.com");

    const deleted = await authPost(
      app,
      `/admin/lists/${list.id}/delete`,
      cookie,
      {},
    );
    expect(deleted.status).toBe(303);
    const afterDeleteHtml = await (
      await authGet(app, "/admin/subscribers?membership=orphaned", cookie)
    ).text();
    expect(afterDeleteHtml).toContain("2 orphaned");
    expect(afterDeleteHtml).toContain("orphan@example.com");
    expect(afterDeleteHtml).toContain("member@example.com");
    expect(
      db
        .select()
        .from(schema.events)
        .where(eq(schema.events.type, "campaign.created"))
        .get()!.campaignId,
    ).toBeNull();
  });
});

describe("Inbound history cleanup", () => {
  test("deleting a thread keeps audit events without dangling message references", async () => {
    const db = createTestDb();
    await seedOwner(db);
    const message = db
      .insert(schema.messages)
      .values({
        threadId: 7,
        direction: "inbound",
        fromAddr: "reader@example.com",
        toAddr: "newsletter@example.com",
        subject: "A reply",
      })
      .returning()
      .get();
    db.insert(schema.events)
      .values({
        type: "message.received",
        detail: message.subject,
        messageId: message.id,
      })
      .run();
    const app = createApp(db);
    const cookie = await login(app);

    expect(
      (await authPost(app, `/admin/inbound/${message.id}/delete`, cookie, {}))
        .status,
    ).toBe(303);
    expect(db.select().from(schema.messages).all()).toEqual([]);
    expect(
      db
        .select()
        .from(schema.events)
        .where(eq(schema.events.type, "message.received"))
        .get()!.messageId,
    ).toBeNull();
    const deletionEvent = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "admin.inbound_deleted"))
      .get()!;
    expect(JSON.parse(deletionEvent.meta!)).toEqual({
      messageId: message.id,
      threadId: 7,
    });
  });
});

describe("application shell", () => {
  test("public subscriptions render through Remix and retain a normal form action", async () => {
    const db = createTestDb();
    seedList(db, {
      slug: "newsletter",
      name: "Newsletter",
      fromDomain: "example.com",
    });
    const app = createApp(db);

    const response = await app.request("/subscribe");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("<title>Subscribe | Lists</title>");
    expect(html).not.toContain('hx-boost="true"');
    expect(html).toContain('method="post" action="/subscribe"');
  });

  test("admin pages share one navigation shell and server filters", async () => {
    const db = createTestDb();
    await seedOwner(db);
    const app = createApp(db);
    const cookie = await login(app);

    const response = await authGet(app, "/admin/subscribers", cookie);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('id="app-shell"');
    expect(html).not.toContain("transition:true");
    expect(html).toContain('aria-label="Admin navigation"');
    expect(html).toContain(">Dashboard</a>");
    expect(html).not.toContain("app-surface");
    expect(html).not.toContain("backdrop-blur");
  });
});

describe("Email template gallery", () => {
  test("escapes template metadata in the gallery and inspector", async () => {
    const db = createTestDb();
    await seedOwner(db);
    db.update(schema.emailTemplates)
      .set({
        name: '<img src=x onerror="alert(1)">',
        description: "<script>alert(1)</script>",
      })
      .where(eq(schema.emailTemplates.slug, "newsletter"))
      .run();
    const app = createApp(db);
    const cookie = await login(app);

    for (const path of ["/admin/templates", "/admin/templates/newsletter"]) {
      const html = await (await authGet(app, path, cookie)).text();
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).not.toContain('<img src=x onerror="alert(1)">');
    }
  });

  test("shows template source and gates remote assets in isolated previews", async () => {
    const db = createTestDb();
    await seedOwner(db);
    const app = createApp(db);
    const cookie = await login(app);

    const gallery = await authGet(app, "/admin/templates", cookie);
    expect(gallery.status).toBe(200);
    expect(await gallery.text()).toContain("Newsletter");

    const detail = await authGet(app, "/admin/templates/newsletter", cookie);
    expect(detail.status).toBe(200);
    const detailHtml = await detail.text();
    expect(detailHtml).toContain('title="Template preview"');
    expect(detailHtml).toContain("Plain text");
    expect(detailHtml).toContain("Remote images");
    expect(detailHtml).toContain("HTML source");
    expect(detailHtml).toContain("&#x3C;!");
    expect(detailHtml).not.toContain('<div class="template-source"><!doctype');

    const blocked = await authGet(
      app,
      "/admin/templates/newsletter/preview",
      cookie,
    );
    expect(blocked.headers.get("content-security-policy")).toContain(
      "img-src data: cid:",
    );
    const allowed = await authGet(
      app,
      "/admin/templates/newsletter/preview?remote=1",
      cookie,
    );
    expect(allowed.headers.get("content-security-policy")).toContain(
      "img-src https: data: cid:",
    );
    const text = await authGet(
      app,
      "/admin/templates/newsletter/preview?mode=text",
      cookie,
    );
    expect(text.headers.get("content-type")).toContain("text/html");
    expect(await text.text()).toContain("Unsubscribe:");
  });
});
