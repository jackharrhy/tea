import { test, expect, describe, beforeEach } from "bun:test";
import { mockClient } from "aws-sdk-client-mock";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { eq, and, desc } from "drizzle-orm";
import { createApplication } from "../src/http-app.ts";

import { createTestDb, seedList } from "./helpers";
import { sendCampaign } from "../src/services/sender";
import {
  processDueDeliveries,
  recoverAbandonedDeliveries,
  rescheduleInterruptedCampaigns,
} from "../src/services/delivery-worker";
import * as schema from "../src/db/schema";
import type { Config } from "../src/config";
import {
  createSubscriber,
  confirmSubscriber,
} from "../src/services/subscriber";
import { createSession } from "../src/auth";
import { compileTemplate } from "../src/services/email-templates";

const sesMock = mockClient(SESv2Client);

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
});

// ---------------------------------------------------------------------------
// 1. Full campaign send flow
// ---------------------------------------------------------------------------
describe("Full campaign send flow", () => {
  test("sends to a confirmed subscriber and records the send", async () => {
    const db = createTestDb();
    const list = seedList(db, {
      slug: "newsletter",
      fromDomain: "example.com",
    });

    // create confirmed subscriber
    const sub = createSubscriber(db, "reader@example.com", "Reader", null, [
      "newsletter",
    ]);
    confirmSubscriber(db, sub.unsubscribeToken);

    // create draft campaign
    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: list.id,
        subject: "Hello World",
        bodyMarkdown: "# Welcome\n\nThis is a test campaign.",
        fromAddress: "news@example.com",
        status: "draft",
      })
      .returning()
      .get();

    // mock SES
    sesMock.on(SendEmailCommand).resolves({ MessageId: "test-msg-id" });

    await sendCampaign(db, testConfig, campaign.id);

    // campaign should be "sent"
    const updated = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .get();
    expect(updated!.status).toBe("sent");
    expect(updated!.sentAt).not.toBeNull();

    // campaignSends should have 1 entry with status "sent"
    const sends = db
      .select()
      .from(schema.campaignSends)
      .where(eq(schema.campaignSends.campaignId, campaign.id))
      .all();
    expect(sends).toHaveLength(1);
    expect(sends[0].status).toBe("accepted");
    expect(sends[0].sesMessageId).toBe("test-msg-id");

    // SES should have been called exactly once
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(1);

    // The call should contain Raw email data
    const input = sesCalls[0].args[0].input;
    expect(input.Content?.Raw?.Data).toBeDefined();
    expect(input.ConfigurationSetName).toBe("test-config-set");
    expect(input.EmailTags).toEqual(
      expect.arrayContaining([
        { Name: "campaign_id", Value: String(campaign.id) },
        { Name: "subscriber_id", Value: String(sub.id) },
        { Name: "message_kind", Value: "campaign" },
      ]),
    );
  });

  test("sends the current mutable custom HTML and text template", async () => {
    const db = createTestDb();
    const list = seedList(db, {
      slug: "custom",
      name: "Custom List",
      fromDomain: "example.com",
    });
    const subscriber = createSubscriber(
      db,
      "reader@example.com",
      "Reader",
      null,
      ["custom"],
    );
    confirmSubscriber(db, subscriber.unsubscribeToken);
    const source = {
      sourceFormat: "html" as const,
      htmlSource:
        '<html><body><h1>V1 {{subscriber.firstName}}</h1>{{{sections.message.html}}}<a href="{{links.unsubscribe}}">bye</a></body></html>',
      textSource:
        "V1 {{subscriber.firstName}}\n{{sections.message.text}}\n{{links.unsubscribe}}",
      sections: [
        {
          key: "message",
          name: "Message",
          format: "markdown" as const,
          required: true,
        },
      ],
      partials: {},
    };
    const compiled = await compileTemplate(source);
    const template = db
      .insert(schema.emailTemplates)
      .values({
        slug: "letter",
        name: "Letter",
        status: "active",
        ...source,
        compiledHtml: compiled.compiledHtml,
        sections: JSON.stringify(source.sections),
        partials: "{}",
      })
      .returning()
      .get();
    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: list.id,
        subject: "Mutable template",
        bodyMarkdown: "# Hello custom HTML",
        fromAddress: "news@example.com",
        status: "draft",
        templateSlug: template.slug,
        templateSections: JSON.stringify({ message: "# Hello custom HTML" }),
      })
      .returning()
      .get();
    db.update(schema.emailTemplates)
      .set({
        htmlSource: source.htmlSource.replace("V1", "V2"),
        compiledHtml: compiled.compiledHtml!.replace("V1", "V2"),
        textSource: source.textSource.replace("V1", "V2"),
      })
      .where(eq(schema.emailTemplates.id, template.id))
      .run();
    sesMock
      .on(SendEmailCommand)
      .resolves({ MessageId: "custom-template-message" });

    await sendCampaign(db, testConfig, campaign.id);

    const raw = new TextDecoder().decode(
      sesMock.commandCalls(SendEmailCommand)[0]!.args[0].input.Content!.Raw!
        .Data as Uint8Array,
    );
    expect(raw).toContain("V2 Reader");
    expect(raw).not.toContain("V1 Reader");
    expect(raw).toContain("Hello custom HTML");
    expect(raw).toContain("multipart/alternative");
  });

  test("defers retryable SES failures and the worker later accepts them", async () => {
    const db = createTestDb();
    const list = seedList(db, {
      slug: "newsletter",
      fromDomain: "example.com",
    });
    const sub = createSubscriber(db, "retry@example.com", "Retry", null, [
      "newsletter",
    ]);
    confirmSubscriber(db, sub.unsubscribeToken);
    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: list.id,
        subject: "Retry me",
        bodyMarkdown: "Hello",
        fromAddress: "news@example.com",
        status: "draft",
      })
      .returning()
      .get();

    const throttle = Object.assign(new Error("rate limited"), {
      name: "ThrottlingException",
      $metadata: { httpStatusCode: 429 },
    });
    sesMock.on(SendEmailCommand).rejects(throttle);
    await sendCampaign(db, testConfig, campaign.id);

    let delivery = db.select().from(schema.campaignSends).get()!;
    expect(delivery.status).toBe("deferred");
    expect(delivery.attemptCount).toBe(1);
    expect(delivery.nextAttemptAt).not.toBeNull();
    expect(db.select().from(schema.campaigns).get()!.status).toBe("sending");

    db.update(schema.campaignSends)
      .set({ nextAttemptAt: new Date(0).toISOString() })
      .where(eq(schema.campaignSends.id, delivery.id))
      .run();
    sesMock.on(SendEmailCommand).resolves({ MessageId: "retried-ses-id" });
    await processDueDeliveries(db, testConfig);

    delivery = db.select().from(schema.campaignSends).get()!;
    expect(delivery.status).toBe("accepted");
    expect(delivery.attemptCount).toBe(2);
    expect(delivery.sesMessageId).toBe("retried-ses-id");
    expect(db.select().from(schema.campaigns).get()!.status).toBe("sent");
  });

  test("recovers an attempt stranded by a restart", () => {
    const db = createTestDb();
    const list = seedList(db, {
      slug: "newsletter",
      fromDomain: "example.com",
    });
    const sub = createSubscriber(db, "stranded@example.com", "Stranded", null, [
      "newsletter",
    ]);
    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: list.id,
        subject: "Interrupted",
        bodyMarkdown: "Hello",
        fromAddress: "news@example.com",
        status: "sending",
      })
      .returning()
      .get();
    const delivery = db
      .insert(schema.campaignSends)
      .values({
        campaignId: campaign.id,
        subscriberId: sub.id,
        idempotencyKey: `campaign:${campaign.id}:subscriber:${sub.id}`,
        status: "attempting",
        attemptCount: 1,
        lastAttemptAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
      .returning()
      .get();

    expect(
      recoverAbandonedDeliveries(db, new Date("2026-01-01T00:16:00.000Z")),
    ).toBe(1);
    const recovered = db
      .select()
      .from(schema.campaignSends)
      .where(eq(schema.campaignSends.id, delivery.id))
      .get()!;
    expect(recovered.status).toBe("deferred");
    expect(recovered.nextAttemptAt).toBe("2026-01-01T00:16:00.000Z");
  });

  test("reschedules a campaign interrupted by a restart", () => {
    const db = createTestDb();
    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "all",
        subject: "Interrupted campaign",
        bodyMarkdown: "Hello",
        fromAddress: "news@example.com",
        status: "sending",
      })
      .returning()
      .get();

    expect(
      rescheduleInterruptedCampaigns(db, new Date("2026-01-01T00:00:00.000Z")),
    ).toBe(1);
    const recovered = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .get()!;
    expect(recovered.status).toBe("scheduled");
    expect(recovered.scheduledAt).toBe("2026-01-01T00:15:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// 2. Campaign send failure flow
// ---------------------------------------------------------------------------
describe("Campaign send failure flow", () => {
  test("marks the campaign failed when SES rejects every recipient", async () => {
    const db = createTestDb();
    const list = seedList(db, {
      slug: "newsletter",
      fromDomain: "example.com",
    });

    const sub = createSubscriber(db, "reader@example.com", "Reader", null, [
      "newsletter",
    ]);
    confirmSubscriber(db, sub.unsubscribeToken);

    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: list.id,
        subject: "Failing Campaign",
        bodyMarkdown: "# Oops",
        fromAddress: "news@example.com",
        status: "draft",
      })
      .returning()
      .get();

    sesMock.on(SendEmailCommand).rejects(new Error("SES rate limit exceeded"));

    expect(sendCampaign(db, testConfig, campaign.id)).rejects.toThrow(
      "failed for 1 recipient",
    );

    const updated = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .get();
    expect(updated!.status).toBe("failed");
    expect(updated!.lastError).toContain("SES rate limit exceeded");

    // campaignSends should have an entry with status "bounced"
    const sends = db
      .select()
      .from(schema.campaignSends)
      .where(eq(schema.campaignSends.campaignId, campaign.id))
      .all();
    expect(sends).toHaveLength(1);
    expect(sends[0].status).toBe("failed");
    expect(sends[0].sesMessageId).toBeNull();

    sesMock.on(SendEmailCommand).resolves({ MessageId: "manual-retry-id" });
    await sendCampaign(db, testConfig, campaign.id);
    const retried = db
      .select()
      .from(schema.campaignSends)
      .where(eq(schema.campaignSends.campaignId, campaign.id))
      .all();
    expect(retried).toHaveLength(1);
    expect(retried[0].status).toBe("accepted");
    expect(retried[0].attemptCount).toBe(2);
    expect(
      db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, campaign.id))
        .get()!.status,
    ).toBe("sent");
  });

  test("throws for non-existent campaign", async () => {
    const db = createTestDb();
    expect(sendCampaign(db, testConfig, 9999)).rejects.toThrow(
      "Campaign 9999 not found",
    );
  });

  test("throws for campaign that is already sent", async () => {
    const db = createTestDb();
    const list = seedList(db, {
      slug: "newsletter",
      fromDomain: "example.com",
    });
    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: list.id,
        subject: "Already Sent",
        bodyMarkdown: "# Done",
        fromAddress: "news@example.com",
        status: "sent",
        sentAt: new Date().toISOString(),
      })
      .returning()
      .get();

    expect(sendCampaign(db, testConfig, campaign.id)).rejects.toThrow(
      "must be draft, failed, scheduled, or sending",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Campaign retry skips already-sent subscribers
// ---------------------------------------------------------------------------
describe("Campaign retry skips already sent", () => {
  test("only sends to subscribers without a successful send record", async () => {
    const db = createTestDb();
    const list = seedList(db, {
      slug: "newsletter",
      fromDomain: "example.com",
    });

    // subscriber 1: already sent
    const sub1 = createSubscriber(db, "already@example.com", "Already", null, [
      "newsletter",
    ]);
    confirmSubscriber(db, sub1.unsubscribeToken);

    // subscriber 2: not yet sent
    const sub2 = createSubscriber(db, "pending@example.com", "Pending", null, [
      "newsletter",
    ]);
    confirmSubscriber(db, sub2.unsubscribeToken);

    // create a "failed" campaign (eligible for retry)
    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: list.id,
        subject: "Retry Campaign",
        bodyMarkdown: "# Retry",
        fromAddress: "news@example.com",
        status: "failed",
      })
      .returning()
      .get();

    // insert an existing "sent" record for sub1
    db.insert(schema.campaignSends)
      .values({
        campaignId: campaign.id,
        subscriberId: sub1.id,
        sesMessageId: "prev-msg-id",
        status: "sent",
        sentAt: new Date().toISOString(),
      })
      .run();

    sesMock.on(SendEmailCommand).resolves({ MessageId: "retry-msg-id" });

    await sendCampaign(db, testConfig, campaign.id);

    // SES should have been called only once (skipped sub1)
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(1);

    // should have 2 total sends: 1 pre-existing + 1 new
    const sends = db
      .select()
      .from(schema.campaignSends)
      .where(eq(schema.campaignSends.campaignId, campaign.id))
      .all();
    expect(sends).toHaveLength(2);

    const newSend = sends.find((s) => s.subscriberId === sub2.id);
    expect(newSend).toBeDefined();
    expect(newSend!.status).toBe("accepted");
    expect(newSend!.sesMessageId).toBe("retry-msg-id");
  });
});

// ---------------------------------------------------------------------------
// 4. Inbound message processing (simulating poller logic)
// ---------------------------------------------------------------------------
describe("Inbound message processing", () => {
  test("parses SQS payload, matches campaign, and inserts inbound message", () => {
    const db = createTestDb();
    const list = seedList(db, {
      slug: "newsletter",
      fromDomain: "example.com",
    });

    // create a sent campaign to match against
    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: list.id,
        subject: "Sent Campaign",
        bodyMarkdown: "# Sent",
        fromAddress: "news@example.com",
        status: "sent",
        sentAt: new Date().toISOString(),
      })
      .returning()
      .get();

    // simulate an SQS payload as the poller would parse it
    const payload = {
      messageId: "inbound-msg-001",
      timestamp: new Date().toISOString(),
      source: "replier@gmail.com",
      from: ["replier@gmail.com"],
      to: ["newsletter@reply.example.com"],
      subject: "Re: Sent Campaign",
      spamVerdict: "PASS",
      virusVerdict: "PASS",
      spfVerdict: "PASS",
      dkimVerdict: "PASS",
      dmarcVerdict: "PASS",
      action: {
        type: "S3",
        bucketName: "test-bucket",
        objectKeyPrefix: "inbound/",
        objectKey: "inbound/inbound-msg-001",
      },
    };

    // replicate the poller's campaign-matching logic
    let campaignId: number | null = null;
    for (const toAddr of payload.to) {
      const match = toAddr.match(/^([^@]+)@reply\./);
      if (!match) continue;
      const slug = match[1];
      const matchedList = db
        .select()
        .from(schema.lists)
        .where(eq(schema.lists.slug, slug!))
        .get();
      if (!matchedList) continue;
      const matchedCampaign = db
        .select()
        .from(schema.campaigns)
        .where(
          and(
            eq(schema.campaigns.audienceType, "list"),
            eq(schema.campaigns.audienceId, matchedList.id),
            eq(schema.campaigns.status, "sent"),
          ),
        )
        .orderBy(desc(schema.campaigns.sentAt))
        .get();
      if (matchedCampaign) {
        campaignId = matchedCampaign.id;
        break;
      }
    }

    const s3Key =
      payload.action.objectKey ||
      payload.action.objectKeyPrefix + payload.messageId;

    const fromAddr = payload.from[0] ?? payload.source;
    const toAddr = payload.to[0] ?? "";

    db.insert(schema.messages)
      .values({
        threadId: 0,
        direction: "inbound",
        sesMessageId: payload.messageId,
        fromAddr,
        toAddr,
        subject: payload.subject,
        spamVerdict: payload.spamVerdict,
        virusVerdict: payload.virusVerdict,
        spfVerdict: payload.spfVerdict,
        dkimVerdict: payload.dkimVerdict,
        dmarcVerdict: payload.dmarcVerdict,
        s3Key,
        campaignId,
      })
      .onConflictDoNothing({
        target: schema.messages.sesMessageId,
      })
      .run();

    // verify it was inserted
    const inbound = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sesMessageId, "inbound-msg-001"))
      .get();

    expect(inbound).toBeDefined();
    expect(inbound!.fromAddr).toBe("replier@gmail.com");
    expect(inbound!.subject).toBe("Re: Sent Campaign");
    expect(inbound!.s3Key).toBe("inbound/inbound-msg-001");
    expect(inbound!.toAddr).toBe("newsletter@reply.example.com");

    // campaignId should be linked correctly
    expect(inbound!.campaignId).toBe(campaign.id);
  });
});

// ---------------------------------------------------------------------------
// 6. Per-list unsubscribe flow
// ---------------------------------------------------------------------------
describe("Per-list unsubscribe flow via App", () => {
  test("GET /unsubscribe/:token/:listId unsubscribes from one list only", async () => {
    const db = createTestDb();
    const listA = seedList(db, {
      slug: "list-a",
      name: "List A",
      fromDomain: "example.com",
    });
    const listB = seedList(db, {
      slug: "list-b",
      name: "List B",
      fromDomain: "example.com",
    });

    const subscriber = createSubscriber(
      db,
      "reader@example.com",
      "Reader",
      null,
      ["list-a", "list-b"],
    );
    confirmSubscriber(db, subscriber.unsubscribeToken);

    const app = createApplication(db, testConfig);

    const res = await app.request(
      `/unsubscribe/${subscriber.unsubscribeToken}/${listA.id}`,
      {
        method: "GET",
      },
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("List A");
    expect(html).toContain("Manage all your subscriptions");
    expect(html).toContain("still subscribed to 1 other list");

    // list-a should be unsubscribed
    const subListA = db
      .select()
      .from(schema.subscriberLists)
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subscriber.id),
          eq(schema.subscriberLists.listId, listA.id),
        ),
      )
      .get();
    expect(subListA!.status).toBe("unsubscribed");

    // list-b should still be confirmed
    const subListB = db
      .select()
      .from(schema.subscriberLists)
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subscriber.id),
          eq(schema.subscriberLists.listId, listB.id),
        ),
      )
      .get();
    expect(subListB!.status).toBe("confirmed");
  });

  test("POST /unsubscribe/:token/:listId RFC 8058 one-click per-list", async () => {
    const db = createTestDb();
    const listA = seedList(db, {
      slug: "list-a",
      name: "List A",
      fromDomain: "example.com",
    });
    const listB = seedList(db, {
      slug: "list-b",
      name: "List B",
      fromDomain: "example.com",
    });

    const subscriber = createSubscriber(
      db,
      "reader@example.com",
      "Reader",
      null,
      ["list-a", "list-b"],
    );
    confirmSubscriber(db, subscriber.unsubscribeToken);

    const app = createApplication(db, testConfig);

    const res = await app.request(
      `/unsubscribe/${subscriber.unsubscribeToken}/${listA.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      },
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("Unsubscribed");

    // list-a should be unsubscribed
    const subListA = db
      .select()
      .from(schema.subscriberLists)
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subscriber.id),
          eq(schema.subscriberLists.listId, listA.id),
        ),
      )
      .get();
    expect(subListA!.status).toBe("unsubscribed");

    // list-b should still be confirmed
    const subListB = db
      .select()
      .from(schema.subscriberLists)
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subscriber.id),
          eq(schema.subscriberLists.listId, listB.id),
        ),
      )
      .get();
    expect(subListB!.status).toBe("confirmed");
  });
});

// ---------------------------------------------------------------------------
// 12. audienceData format regression
// ---------------------------------------------------------------------------
describe("audienceData format regression", () => {
  test("audienceData must be a flat array, not a wrapped object", async () => {
    const db = createTestDb();
    seedList(db, {
      slug: "newsletter",
      fromDomain: "example.com",
    });
    const sub1 = createSubscriber(db, "a@example.com", "A", null, [
      "newsletter",
    ]);
    confirmSubscriber(db, sub1.unsubscribeToken);

    // This is the OLD broken format that the admin UI was producing
    const brokenCampaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "subscribers",
        audienceData: JSON.stringify({ subscriberIds: [sub1.id] }),
        subject: "Broken",
        bodyMarkdown: "test",
        fromAddress: "test@example.com",
        status: "draft",
      })
      .returning()
      .get();

    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg" });

    // This should throw because JSON.parse returns an object, not an array
    expect(sendCampaign(db, testConfig, brokenCampaign.id)).rejects.toThrow();
  });

  test("an empty subscriber audience completes without invalid SQL", async () => {
    const db = createTestDb();
    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "subscribers",
        audienceData: "[]",
        subject: "Nobody",
        bodyMarkdown: "test",
        fromAddress: "test@example.com",
        status: "draft",
      })
      .returning()
      .get();

    await sendCampaign(db, testConfig, campaign.id);

    const updated = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .get();
    expect(updated!.status).toBe("sent");
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Helper: create owner user + login session for admin tests
// ---------------------------------------------------------------------------
function createOwnerAndSession(db: ReturnType<typeof createTestDb>) {
  const passwordHash = Bun.password.hashSync("testpass123");
  const user = db
    .insert(schema.users)
    .values({
      email: "owner@example.com",
      name: "Owner",
      passwordHash,
      role: "owner",
    })
    .returning()
    .get();
  const sessionToken = createSession(db, user.id);
  return { user, sessionToken };
}

// ---------------------------------------------------------------------------
// 8. Preview endpoint returns rendered email HTML
// ---------------------------------------------------------------------------
describe("GET /campaigns/:id/preview", () => {
  test("returns rendered email HTML without AdminLayout nav", async () => {
    const db = createTestDb();
    const list = seedList(db, {
      slug: "newsletter",
      name: "Newsletter",
      fromDomain: "example.com",
    });

    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: list.id,
        subject: "Preview Test Subject",
        bodyMarkdown: "# Big Heading\n\nSome **bold** content here.",
        fromAddress: "news@example.com",
        status: "draft",
      })
      .returning()
      .get();

    const { sessionToken } = createOwnerAndSession(db);

    const app = createApplication(db, testConfig);

    const res = await app.request(`/admin/campaigns/${campaign.id}/preview`, {
      headers: { Cookie: `session=${sessionToken}` },
    });

    expect(res.status).toBe(200);
    const html = await res.text();

    // Should contain the campaign subject
    expect(html).toContain("Preview Test Subject");
    // Should contain rendered markdown (h1 tag, not raw "# Big Heading")
    expect(html).toContain("<h1>Big Heading</h1>");
    // Should contain rendered bold text
    expect(html).toContain("<strong>bold</strong>");
    // Should NOT contain AdminLayout nav bar
    expect(html).not.toContain("Dashboard");
    expect(html).not.toContain('class="bg-gray-900');
  });
});

// ---------------------------------------------------------------------------
// 9. Preview endpoint with subscriberId includes real unsubscribe URL
// ---------------------------------------------------------------------------
describe("GET /campaigns/:id/preview?subscriberId=N", () => {
  test("includes real unsubscribe URL with subscriber token", async () => {
    const db = createTestDb();
    const list = seedList(db, {
      slug: "newsletter",
      name: "Newsletter",
      fromDomain: "example.com",
    });

    const sub = createSubscriber(db, "reader@example.com", "Reader", null, [
      "newsletter",
    ]);
    confirmSubscriber(db, sub.unsubscribeToken);

    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: list.id,
        subject: "Unsub Preview",
        bodyMarkdown: "# Content",
        fromAddress: "news@example.com",
        status: "draft",
      })
      .returning()
      .get();

    const { sessionToken } = createOwnerAndSession(db);

    const app = createApplication(db, testConfig);

    const res = await app.request(
      `/admin/campaigns/${campaign.id}/preview?subscriberId=${sub.id}`,
      {
        headers: { Cookie: `session=${sessionToken}` },
      },
    );

    expect(res.status).toBe(200);
    const html = await res.text();

    // Should contain a real unsubscribe URL (not the placeholder)
    expect(html).toContain("/unsubscribe/");
    expect(html).not.toContain("#unsubscribe");
    // Should contain the subscriber's actual token
    expect(html).toContain(sub.unsubscribeToken);
  });
});

// ---------------------------------------------------------------------------
// 10. POST preview endpoint renders markdown
// ---------------------------------------------------------------------------
describe("POST /campaigns/preview", () => {
  test("renders markdown body into HTML", async () => {
    const db = createTestDb();
    const { sessionToken } = createOwnerAndSession(db);

    const app = createApplication(db, testConfig);

    const res = await app.request("/admin/campaigns/preview", {
      method: "POST",
      headers: {
        Cookie: `session=${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bodyMarkdown: "# Hello\n\nWorld",
        subject: "Test",
        listName: "My List",
      }),
    });

    expect(res.status).toBe(200);
    const html = await res.text();

    // Should contain rendered h1, not raw markdown
    expect(html).toContain("<h1>Hello</h1>");
    // Should contain the paragraph text
    expect(html).toContain("World");
  });
});

// ---------------------------------------------------------------------------
// 13. Poller stores rfc822MessageId
// ---------------------------------------------------------------------------
describe("Poller stores rfc822MessageId", () => {
  test("inserts rfc822MessageId from SQS payload into DB", () => {
    const db = createTestDb();
    seedList(db, { slug: "newsletter", fromDomain: "example.com" });

    const payload = {
      messageId: "rfc822-test-001",
      rfc822MessageId: "<CAF4Ud9Q123@mail.gmail.com>",
      timestamp: new Date().toISOString(),
      source: "sender@gmail.com",
      from: ["sender@gmail.com"],
      to: ["newsletter@reply.example.com"],
      subject: "Test with RFC822 ID",
      spamVerdict: "PASS",
      virusVerdict: "PASS",
      spfVerdict: "PASS",
      dkimVerdict: "PASS",
      dmarcVerdict: "PASS",
      action: {
        type: "S3",
        bucketName: "test-bucket",
        objectKeyPrefix: "inbound/",
        objectKey: "inbound/rfc822-test-001",
      },
    };

    const s3Key =
      payload.action.objectKey ||
      payload.action.objectKeyPrefix + payload.messageId;

    db.insert(schema.messages)
      .values({
        threadId: 0,
        direction: "inbound",
        sesMessageId: payload.messageId,
        rfc822MessageId: payload.rfc822MessageId ?? null,
        fromAddr: payload.from[0] ?? payload.source,
        toAddr: payload.to[0] ?? "",
        subject: payload.subject,
        spamVerdict: payload.spamVerdict,
        virusVerdict: payload.virusVerdict,
        spfVerdict: payload.spfVerdict,
        dkimVerdict: payload.dkimVerdict,
        dmarcVerdict: payload.dmarcVerdict,
        s3Key,
      })
      .onConflictDoNothing({ target: schema.messages.sesMessageId })
      .run();

    const inbound = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sesMessageId, "rfc822-test-001"))
      .get();

    expect(inbound).toBeDefined();
    expect(inbound!.rfc822MessageId).toBe("<CAF4Ud9Q123@mail.gmail.com>");
  });
});

// ---------------------------------------------------------------------------
// 14. Poller handles missing rfc822MessageId (old Lambda)
// ---------------------------------------------------------------------------
describe("Poller handles missing rfc822MessageId", () => {
  test("stores null when payload has no rfc822MessageId field", () => {
    const db = createTestDb();
    seedList(db, { slug: "newsletter", fromDomain: "example.com" });

    const payload = {
      messageId: "rfc822-missing-001",
      // no rfc822MessageId field
      timestamp: new Date().toISOString(),
      source: "sender@gmail.com",
      from: ["sender@gmail.com"],
      to: ["newsletter@reply.example.com"],
      subject: "Test without RFC822 ID",
      spamVerdict: "PASS",
      virusVerdict: "PASS",
      spfVerdict: "PASS",
      dkimVerdict: "PASS",
      dmarcVerdict: "PASS",
      action: {
        type: "S3",
        bucketName: "test-bucket",
        objectKeyPrefix: "inbound/",
        objectKey: "inbound/rfc822-missing-001",
      },
    } as {
      messageId: string;
      rfc822MessageId?: string;
      timestamp: string;
      source: string;
      from: string[];
      to: string[];
      subject: string;
      spamVerdict: string;
      virusVerdict: string;
      spfVerdict: string;
      dkimVerdict: string;
      dmarcVerdict: string;
      action: {
        type: string;
        bucketName: string;
        objectKeyPrefix: string;
        objectKey: string;
      };
    };

    const s3Key =
      payload.action.objectKey ||
      payload.action.objectKeyPrefix + payload.messageId;

    db.insert(schema.messages)
      .values({
        threadId: 0,
        direction: "inbound",
        sesMessageId: payload.messageId,
        rfc822MessageId: payload.rfc822MessageId ?? null,
        fromAddr: payload.from[0] ?? payload.source,
        toAddr: payload.to[0] ?? "",
        subject: payload.subject,
        spamVerdict: payload.spamVerdict,
        virusVerdict: payload.virusVerdict,
        spfVerdict: payload.spfVerdict,
        dkimVerdict: payload.dkimVerdict,
        dmarcVerdict: payload.dmarcVerdict,
        s3Key,
      })
      .onConflictDoNothing({ target: schema.messages.sesMessageId })
      .run();

    const inbound = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sesMessageId, "rfc822-missing-001"))
      .get();

    expect(inbound).toBeDefined();
    expect(inbound!.rfc822MessageId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 15. Reply uses RFC 822 Message-ID for threading headers
// ---------------------------------------------------------------------------
describe("Reply uses RFC 822 Message-ID for threading headers", () => {
  test("sets In-Reply-To and References headers from rfc822MessageId", async () => {
    const db = createTestDb();
    seedList(db, { slug: "newsletter", fromDomain: "example.com" });

    const { sessionToken } = createOwnerAndSession(db);

    // Insert an inbound message with a known rfc822MessageId
    const inbound = db
      .insert(schema.messages)
      .values({
        threadId: 0,
        direction: "inbound",
        sesMessageId: "thread-test-001",
        rfc822MessageId: "<original-msg-id@gmail.com>",
        fromAddr: "sender@gmail.com",
        toAddr: "newsletter@reply.example.com",
        subject: "Original Subject",
        spamVerdict: "PASS",
        virusVerdict: "PASS",
        spfVerdict: "PASS",
        dkimVerdict: "PASS",
        dmarcVerdict: "PASS",
        s3Key: "inbound/thread-test-001",
      })
      .returning()
      .get();

    sesMock.on(SendEmailCommand).resolves({ MessageId: "ses-reply-msg-id" });

    const app = createApplication(db, testConfig);

    const formBody = new URLSearchParams({
      fromAddr: "admin@example.com",
      toAddr: "sender@gmail.com",
      subject: "Re: Original Subject",
      body: "Thanks for your email!",
    });

    const res = await app.request(`/admin/inbound/${inbound.id}/reply`, {
      method: "POST",
      headers: {
        Cookie: `session=${sessionToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
    });

    // Should redirect after success
    expect(res.status).toBe(303);

    // SES should have been called once
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(1);

    // Extract and decode the raw email
    const rawData = sesCalls[0].args[0].input.Content?.Raw?.Data;
    expect(rawData).toBeDefined();
    const rawEmail = new TextDecoder().decode(rawData as Uint8Array);

    // Should contain threading headers with the RFC 822 Message-ID
    expect(rawEmail).toContain("In-Reply-To: <original-msg-id@gmail.com>");
    expect(rawEmail).toContain("References: <original-msg-id@gmail.com>");

    // Should NOT use the SES internal messageId in In-Reply-To
    expect(rawEmail).not.toContain("In-Reply-To: ses-reply-msg-id");
  });
});

// ---------------------------------------------------------------------------
// 16. Reply omits threading headers when rfc822MessageId is null
// ---------------------------------------------------------------------------
describe("Reply omits threading headers when rfc822MessageId is null", () => {
  test("does not include In-Reply-To or References when rfc822MessageId is null", async () => {
    const db = createTestDb();
    seedList(db, { slug: "newsletter", fromDomain: "example.com" });

    const { sessionToken } = createOwnerAndSession(db);

    // Insert an inbound message with NO rfc822MessageId
    const inbound = db
      .insert(schema.messages)
      .values({
        threadId: 0,
        direction: "inbound",
        sesMessageId: "no-thread-test-001",
        rfc822MessageId: null,
        fromAddr: "sender@gmail.com",
        toAddr: "newsletter@reply.example.com",
        subject: "No Thread Subject",
        spamVerdict: "PASS",
        virusVerdict: "PASS",
        spfVerdict: "PASS",
        dkimVerdict: "PASS",
        dmarcVerdict: "PASS",
        s3Key: "inbound/no-thread-test-001",
      })
      .returning()
      .get();

    sesMock.on(SendEmailCommand).resolves({ MessageId: "ses-noreply-msg-id" });

    const app = createApplication(db, testConfig);

    const formBody = new URLSearchParams({
      fromAddr: "admin@example.com",
      toAddr: "sender@gmail.com",
      subject: "Re: No Thread Subject",
      body: "Thanks for your email!",
    });

    const res = await app.request(`/admin/inbound/${inbound.id}/reply`, {
      method: "POST",
      headers: {
        Cookie: `session=${sessionToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
    });

    // Should redirect after success
    expect(res.status).toBe(303);

    // SES should have been called once
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(1);

    // Extract and decode the raw email
    const rawData = sesCalls[0].args[0].input.Content?.Raw?.Data;
    expect(rawData).toBeDefined();
    const rawEmail = new TextDecoder().decode(rawData as Uint8Array);

    // Should NOT contain threading headers at all
    expect(rawEmail).not.toContain("In-Reply-To:");
    expect(rawEmail).not.toContain("References:");
  });
});

// ---------------------------------------------------------------------------
// 17. Thread matching via SES-rewritten Message-ID
// ---------------------------------------------------------------------------
describe("Thread matching via SES-rewritten Message-ID", () => {
  test("inbound reply threads correctly when In-Reply-To uses SES format", () => {
    const db = createTestDb();

    // Simulate: we sent an outbound message (reply)
    // Our generated rfc822MessageId: <uuid@reply.example.com>
    // SES rewrites this to <sesId@email.amazonses.com> on delivery
    // When recipient replies, their In-Reply-To points to the SES-rewritten ID

    const outboundSesId =
      "0100019cfd0b2cd2-c18f07a0-4e9e-45c7-8a4c-bc835326eb3c-000000";
    const ourGeneratedMsgId =
      "<f02cdfa1-8fee-4cdb-bad2-799dd524e6ac@reply.example.com>";

    // Insert the original inbound message (root of thread)
    db.insert(schema.messages)
      .values({
        threadId: 0,
        direction: "inbound",
        rfc822MessageId: "<original@gmail.com>",
        fromAddr: "user@gmail.com",
        toAddr: "list@reply.example.com",
        subject: "Hello",
        sesMessageId: "original-ses-id",
        createdAt: new Date().toISOString(),
      })
      .run();
    const root = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sesMessageId, "original-ses-id"))
      .get()!;
    db.update(schema.messages)
      .set({ threadId: root.id })
      .where(eq(schema.messages.id, root.id))
      .run();

    // Insert our outbound reply
    db.insert(schema.messages)
      .values({
        threadId: root.id,
        parentId: root.id,
        direction: "outbound",
        rfc822MessageId: ourGeneratedMsgId,
        inReplyTo: "<original@gmail.com>",
        fromAddr: "list@reply.example.com",
        toAddr: "user@gmail.com",
        subject: "Re: Hello",
        sesMessageId: outboundSesId,
        sentAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      })
      .run();

    // Now simulate an inbound reply that references the SES-rewritten ID
    // This is what actually happens: Gmail replies with In-Reply-To pointing to
    // <sesId@email.amazonses.com>, NOT our original <uuid@reply.example.com>
    const inReplyTo = `<${outboundSesId}@email.amazonses.com>`;
    const sesIdFromReply = inReplyTo.replace(/^<|>$/g, "").split("@")[0] ?? "";

    // This is the matching logic from the poller:
    // 1. Try exact match on rfc822MessageId
    let parentMsg = db
      .select({ id: schema.messages.id, threadId: schema.messages.threadId })
      .from(schema.messages)
      .where(eq(schema.messages.rfc822MessageId, inReplyTo))
      .get();

    // This should NOT match (our rfc822MessageId is different from the SES-rewritten one)
    expect(parentMsg).toBeUndefined();

    // 2. Try matching against sesMessageId
    parentMsg = db
      .select({ id: schema.messages.id, threadId: schema.messages.threadId })
      .from(schema.messages)
      .where(eq(schema.messages.sesMessageId, sesIdFromReply))
      .get();

    // This SHOULD match our outbound message
    expect(parentMsg).toBeDefined();
    expect(parentMsg!.threadId).toBe(root.id);
  });
});
