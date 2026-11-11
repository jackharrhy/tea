import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { createWebhookRouter } from "../app/webhook-router.ts";
import { createTestDb, seedSubscriber, seedList } from "./helpers";
import { eq } from "drizzle-orm";

// Skip SNS signature verification in tests (fake payloads won't have valid RSA sigs)
process.env.NODE_ENV = "test";
process.env.SNS_SKIP_VERIFY = "true";
import * as schema from "../src/db/schema";

const SNS_BASE = {
  MessageId: "test-msg-id",
  TopicArn: "arn:aws:sns:us-east-1:123:test",
  Timestamp: "2026-03-17T00:00:00.000Z",
  SignatureVersion: "1",
  Signature: "FAKESIG",
  SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
};

function makeApp(db: ReturnType<typeof createTestDb>) {
  return createWebhookRouter(db);
}

function postSes(
  app: ReturnType<typeof createWebhookRouter>,
  body: unknown,
  messageType: string | null = "Notification",
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (messageType !== null) {
    headers["x-amz-sns-message-type"] = messageType;
  }
  return app.fetch(
    new Request("http://localhost/webhooks/ses", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

function postSesAsSns(
  app: ReturnType<typeof createWebhookRouter>,
  body: unknown,
  messageType = "Notification",
) {
  return app.fetch(
    new Request("http://localhost/webhooks/ses", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=UTF-8",
        "x-amz-sns-message-type": messageType,
      },
      body: JSON.stringify(body),
    }),
  );
}

function makeHardBounceBody(email: string) {
  const message = JSON.stringify({
    eventType: "Bounce",
    mail: {
      timestamp: "2026-03-17T00:00:00.000Z",
      messageId: "ses-msg-id",
      source: "sender@example.com",
      destination: [email],
    },
    bounce: {
      bounceType: "Permanent",
      bounceSubType: "General",
      bouncedRecipients: [
        {
          emailAddress: email,
          action: "failed",
          status: "5.1.1",
          diagnosticCode: "Mailbox does not exist",
        },
      ],
      timestamp: "2026-03-17T00:00:00.000Z",
      feedbackId: "feedback-id",
    },
  });

  return {
    ...SNS_BASE,
    Type: "Notification",
    Message: message,
  };
}

function makeSoftBounceBody(email: string) {
  const message = JSON.stringify({
    eventType: "Bounce",
    mail: {
      timestamp: "2026-03-17T00:00:00.000Z",
      messageId: "ses-msg-id",
      source: "sender@example.com",
      destination: [email],
    },
    bounce: {
      bounceType: "Transient",
      bounceSubType: "MailboxFull",
      bouncedRecipients: [
        {
          emailAddress: email,
          action: "failed",
          status: "4.2.2",
          diagnosticCode: "Mailbox full",
        },
      ],
      timestamp: "2026-03-17T00:00:00.000Z",
      feedbackId: "feedback-id-soft",
    },
  });

  return {
    ...SNS_BASE,
    Type: "Notification",
    Message: message,
  };
}

function makeComplaintBody(email: string) {
  const message = JSON.stringify({
    eventType: "Complaint",
    mail: {
      timestamp: "2026-03-17T00:00:00.000Z",
      messageId: "ses-msg-id",
      source: "sender@example.com",
      destination: [email],
    },
    complaint: {
      complainedRecipients: [{ emailAddress: email }],
      timestamp: "2026-03-17T00:00:00.000Z",
      feedbackId: "complaint-feedback-id",
      complaintFeedbackType: "abuse",
    },
  });

  return {
    ...SNS_BASE,
    Type: "Notification",
    Message: message,
  };
}

function makeLifecycleBody(
  eventType: "Send" | "Delivery" | "DeliveryDelay" | "Reject",
  messageId: string,
) {
  return {
    ...SNS_BASE,
    MessageId: `sns-${eventType.toLowerCase()}-${messageId}`,
    Type: "Notification",
    Message: JSON.stringify({
      eventType,
      mail: {
        timestamp: "2026-03-17T00:00:00.000Z",
        messageId,
        source: "sender@example.com",
        destination: ["reader@example.com"],
      },
    }),
  };
}

describe("POST /webhooks/ses - Delivery lifecycle", () => {
  test("accepts the text/plain JSON body sent by SNS", async () => {
    const db = createTestDb();
    const app = makeApp(db);
    const response = await postSesAsSns(
      app,
      makeLifecycleBody("Send", "ses-text-body"),
    );

    expect(response.status).toBe(200);
    expect(db.select().from(schema.deliveryEvents).all()).toHaveLength(1);
  });

  test("moves an accepted send to delivered and deduplicates repeated SNS events", async () => {
    const db = createTestDb();
    const app = makeApp(db);
    const list = seedList(db);
    const subscriber = seedSubscriber(db, { email: "reader@example.com" });
    const campaign = db
      .insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: list.id,
        subject: "Lifecycle",
        bodyMarkdown: "Hello",
        fromAddress: "news@example.com",
        status: "sent",
      })
      .returning()
      .get();
    db.insert(schema.campaignSends)
      .values({
        campaignId: campaign.id,
        subscriberId: subscriber.id,
        idempotencyKey: `campaign:${campaign.id}:subscriber:${subscriber.id}`,
        sesMessageId: "ses-lifecycle-id",
        status: "accepted",
      })
      .run();

    const body = makeLifecycleBody("Delivery", "ses-lifecycle-id");
    expect((await postSes(app, body)).status).toBe(200);
    expect((await postSes(app, body)).status).toBe(200);

    const delivery = db.select().from(schema.campaignSends).get()!;
    expect(delivery.status).toBe("delivered");
    expect(delivery.deliveredAt).not.toBeNull();
    expect(db.select().from(schema.deliveryEvents).all()).toHaveLength(1);
  });
});

describe("POST /webhooks/ses - SubscriptionConfirmation", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("confirms SNS subscription and returns 200 OK", async () => {
    const db = createTestDb();
    const app = makeApp(db);

    let confirmedUrl: string | null = null;
    global.fetch = mock(async (url: string | URL | Request) => {
      confirmedUrl = url.toString();
      return new Response("OK", { status: 200 });
    }) as unknown as typeof global.fetch;

    const body = {
      ...SNS_BASE,
      Type: "SubscriptionConfirmation",
      Token: "confirm-token-abc",
      SubscribeURL: "https://sns.amazonaws.com/confirm?token=abc",
      Message: "You have chosen to subscribe to the topic.",
    };

    const res = await postSes(app, body, "SubscriptionConfirmation");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    expect(confirmedUrl).toBe("https://sns.amazonaws.com/confirm?token=abc");
  });
});

describe("POST /webhooks/ses - Hard bounce", () => {
  test("blocklists subscriber and logs subscriber.bounced_hard event", async () => {
    const db = createTestDb();
    const app = makeApp(db);

    const subscriber = seedSubscriber(db, { email: "bounce@example.com" });
    const body = makeHardBounceBody("bounce@example.com");

    const res = await postSes(app, body);

    expect(res.status).toBe(200);

    const updated = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.id, subscriber.id))
      .get();
    expect(updated!.status).toBe("blocklisted");

    const events = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.subscriberId, subscriber.id))
      .all();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("subscriber.bounced_hard");
  });
});

describe("POST /webhooks/ses - Soft bounce", () => {
  test("does NOT blocklist subscriber and logs subscriber.bounced_soft event", async () => {
    const db = createTestDb();
    const app = makeApp(db);

    const subscriber = seedSubscriber(db, { email: "softbounce@example.com" });
    const body = makeSoftBounceBody("softbounce@example.com");

    const res = await postSes(app, body);

    expect(res.status).toBe(200);

    const updated = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.id, subscriber.id))
      .get();
    expect(updated!.status).toBe("active");

    const events = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.subscriberId, subscriber.id))
      .all();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("subscriber.bounced_soft");
  });
});

describe("POST /webhooks/ses - Complaint", () => {
  test("blocklists subscriber and logs subscriber.complained event", async () => {
    const db = createTestDb();
    const app = makeApp(db);

    const subscriber = seedSubscriber(db, { email: "complainer@example.com" });
    const body = makeComplaintBody("complainer@example.com");

    const res = await postSes(app, body);

    expect(res.status).toBe(200);

    const updated = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.id, subscriber.id))
      .get();
    expect(updated!.status).toBe("blocklisted");

    const events = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.subscriberId, subscriber.id))
      .all();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("subscriber.complained");
  });
});

describe("POST /webhooks/ses - Invalid body", () => {
  test("returns 400 for body missing required SNS fields", async () => {
    const db = createTestDb();
    const app = makeApp(db);

    const res = await postSes(app, { Type: "Notification", Message: "hello" });

    expect(res.status).toBe(400);
  });
});

describe("POST /webhooks/ses - Missing SNS header", () => {
  test("returns 400 when x-amz-sns-message-type header is absent", async () => {
    const db = createTestDb();
    const app = makeApp(db);

    const body = makeHardBounceBody("someone@example.com");
    const res = await postSes(app, body, null);

    expect(res.status).toBe(400);
  });
});
