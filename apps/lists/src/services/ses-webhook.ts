import { eq } from "drizzle-orm";
import { z } from "zod";
import MessageValidator from "sns-validator";
import { type Db, schema } from "../db";
import { logEvent } from "./events";

const snsValidator = new MessageValidator();

export function shouldVerifySnsSignature(
  env: Record<string, string | undefined> = process.env,
) {
  const localEnvironment =
    env.NODE_ENV === "test" || env.NODE_ENV === "development";
  return env.SNS_SKIP_VERIFY !== "true" || !localEnvironment;
}

async function verifySnsSignature(rawBody: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    snsValidator.validate(
      rawBody as Record<string, unknown>,
      (err: Error | null) => {
        resolve(!err);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// SNS HTTP notification schemas
// https://docs.aws.amazon.com/sns/latest/dg/sns-http-https-endpoint-as-subscriber.html
// ---------------------------------------------------------------------------

const SnsHttpNotificationBase = z.object({
  Type: z.string(),
  MessageId: z.string(),
  TopicArn: z.string(),
  Timestamp: z.string(),
  SignatureVersion: z.string(),
  Signature: z.string(),
  SigningCertURL: z.string(),
});

const SnsSubscriptionConfirmation = SnsHttpNotificationBase.extend({
  Type: z.literal("SubscriptionConfirmation"),
  Token: z.string(),
  SubscribeURL: z.string().url(),
  Message: z.string(),
});

const SnsNotification = SnsHttpNotificationBase.extend({
  Type: z.literal("Notification"),
  Message: z.string(), // JSON-encoded SES event
  Subject: z.string().optional(),
  UnsubscribeURL: z.string().url().optional(),
});

const SnsUnsubscribeConfirmation = SnsHttpNotificationBase.extend({
  Type: z.literal("UnsubscribeConfirmation"),
  Token: z.string(),
  SubscribeURL: z.string().url(),
  Message: z.string(),
});

const SnsHttpBody = z.discriminatedUnion("Type", [
  SnsSubscriptionConfirmation,
  SnsNotification,
  SnsUnsubscribeConfirmation,
]);

// ---------------------------------------------------------------------------
// SES event notification schemas (inside SNS Message field)
// https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html
// ---------------------------------------------------------------------------

const SesBouncedRecipient = z.object({
  emailAddress: z.string().email(),
  action: z.string().optional(),
  status: z.string().optional(),
  diagnosticCode: z.string().optional(),
});

const SesBounce = z.object({
  bounceType: z.enum(["Permanent", "Transient", "Undetermined"]),
  bounceSubType: z.string(),
  bouncedRecipients: z.array(SesBouncedRecipient),
  timestamp: z.string(),
  feedbackId: z.string(),
  reportingMTA: z.string().optional(),
});

const SesComplainedRecipient = z.object({
  emailAddress: z.string().email(),
});

const SesComplaint = z.object({
  complainedRecipients: z.array(SesComplainedRecipient),
  timestamp: z.string(),
  feedbackId: z.string(),
  complaintFeedbackType: z.string().optional(),
  userAgent: z.string().optional(),
});

const SesMail = z.object({
  timestamp: z.string(),
  messageId: z.string(),
  source: z.string(),
  sourceArn: z.string().optional(),
  destination: z.array(z.string()),
});

const SesEventNotification = z.object({
  eventType: z.enum([
    "Bounce",
    "Complaint",
    "Delivery",
    "Send",
    "Reject",
    "Open",
    "Click",
    "Rendering Failure",
    "RenderingFailure",
    "DeliveryDelay",
    "Subscription",
  ]),
  mail: SesMail,
  bounce: SesBounce.optional(),
  complaint: SesComplaint.optional(),
});

// Legacy format: some SES notifications use "notificationType" instead of "eventType"
const SesLegacyNotification = z.object({
  notificationType: z.enum(["Bounce", "Complaint", "Delivery"]),
  mail: SesMail,
  bounce: SesBounce.optional(),
  complaint: SesComplaint.optional(),
});

// ---------------------------------------------------------------------------
// Webhook handler
// ---------------------------------------------------------------------------

export async function handleSesWebhook(
  db: Db,
  request: Request,
): Promise<Response> {
  const messageType = request.headers.get("x-amz-sns-message-type");
  if (!messageType) {
    return new Response("Missing SNS message type header", { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
    if (typeof rawBody === "string") {
      rawBody = JSON.parse(rawBody);
    }
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const parsed = SnsHttpBody.safeParse(rawBody);
  if (!parsed.success) {
    console.error("SNS body parse error:", parsed.error.flatten());
    return new Response("Bad Request", { status: 400 });
  }

  // Verify SNS message signature using AWS's official validator
  // This checks: SigningCertURL is from amazonaws.com, RSA-SHA1 signature is valid
  // The local/test bypass is deliberately ignored in production.
  if (shouldVerifySnsSignature()) {
    const valid = await verifySnsSignature(rawBody);
    if (!valid) {
      console.error("SNS signature verification failed");
      return new Response("Forbidden", { status: 403 });
    }
  }

  const body = parsed.data;

  // 1. Confirm subscription
  if (body.Type === "SubscriptionConfirmation") {
    try {
      await fetch(body.SubscribeURL);
      console.log("SNS subscription confirmed for topic:", body.TopicArn);
    } catch (err) {
      console.error("Failed to confirm SNS subscription:", err);
    }
    return new Response("OK");
  }

  // 2. Notification
  if (body.Type === "Notification") {
    let message: unknown;
    try {
      message = JSON.parse(body.Message);
    } catch {
      console.error("Failed to parse SNS notification Message as JSON");
      return new Response("OK");
    }

    // Try both modern (eventType) and legacy (notificationType) formats
    const event = SesEventNotification.safeParse(message) as
      | { success: true; data: z.infer<typeof SesEventNotification> }
      | { success: false };
    const legacy = !event.success
      ? SesLegacyNotification.safeParse(message)
      : null;

    const eventType = event.success
      ? event.data.eventType
      : legacy?.success
        ? legacy.data.notificationType
        : null;

    if (!eventType) return new Response("OK");

    const sesMessageId = event.success
      ? event.data.mail.messageId
      : legacy?.success
        ? legacy.data.mail.messageId
        : null;
    const recorded = db
      .insert(schema.deliveryEvents)
      .values({
        providerEventId: body.MessageId,
        sesMessageId,
        eventType,
        payload: body.Message,
      })
      .onConflictDoNothing({ target: schema.deliveryEvents.providerEventId })
      .returning()
      .get();
    if (!recorded) return new Response("OK");

    const now = new Date().toISOString();
    if (sesMessageId) {
      const lifecycle =
        eventType === "Delivery"
          ? "delivered"
          : eventType === "DeliveryDelay"
            ? "delivery_delayed"
            : eventType === "Reject"
              ? "rejected"
              : eventType === "Rendering Failure" ||
                  eventType === "RenderingFailure"
                ? "failed"
                : eventType === "Send"
                  ? "accepted"
                  : null;
      if (lifecycle) {
        db.update(schema.campaignSends)
          .set({
            status: lifecycle,
            ...(lifecycle === "delivered" ? { deliveredAt: now } : {}),
            updatedAt: now,
          })
          .where(eq(schema.campaignSends.sesMessageId, sesMessageId))
          .run();
      }
    }

    const bounce = event.success
      ? event.data.bounce
      : legacy?.success
        ? legacy.data.bounce
        : undefined;
    const complaint = event.success
      ? event.data.complaint
      : legacy?.success
        ? legacy.data.complaint
        : undefined;

    if (eventType === "Bounce" && bounce) {
      for (const recipient of bounce.bouncedRecipients) {
        const subscriber = db
          .select()
          .from(schema.subscribers)
          .where(
            eq(schema.subscribers.email, recipient.emailAddress.toLowerCase()),
          )
          .get();
        if (!subscriber) continue;

        if (bounce.bounceType === "Permanent") {
          db.update(schema.subscribers)
            .set({ status: "blocklisted" })
            .where(eq(schema.subscribers.id, subscriber.id))
            .run();
          logEvent(db, {
            type: "subscriber.bounced_hard",
            detail: `${recipient.emailAddress} hard bounced (${bounce.bounceSubType})`,
            subscriberId: subscriber.id,
          });
          console.log(`Hard bounce: blocklisted ${recipient.emailAddress}`);
        } else {
          logEvent(db, {
            type: "subscriber.bounced_soft",
            detail: `${recipient.emailAddress} soft bounced (${bounce.bounceType}: ${bounce.bounceSubType})`,
            subscriberId: subscriber.id,
          });
          console.log(
            `Soft bounce: ${recipient.emailAddress} (${bounce.bounceType})`,
          );
        }

        if (sesMessageId) {
          db.update(schema.campaignSends)
            .set({
              status: "bounced",
              bounceType: `${bounce.bounceType}:${bounce.bounceSubType}`,
              diagnosticCode: recipient.diagnosticCode ?? null,
              lastError:
                recipient.diagnosticCode ?? `${bounce.bounceType} bounce`,
              updatedAt: now,
            })
            .where(eq(schema.campaignSends.sesMessageId, sesMessageId))
            .run();
        }
      }
    } else if (eventType === "Complaint" && complaint) {
      const feedbackType = complaint.complaintFeedbackType ?? "Unknown";
      for (const recipient of complaint.complainedRecipients) {
        const subscriber = db
          .select()
          .from(schema.subscribers)
          .where(
            eq(schema.subscribers.email, recipient.emailAddress.toLowerCase()),
          )
          .get();
        if (!subscriber) continue;

        db.update(schema.subscribers)
          .set({ status: "blocklisted" })
          .where(eq(schema.subscribers.id, subscriber.id))
          .run();
        logEvent(db, {
          type: "subscriber.complained",
          detail: `${recipient.emailAddress} reported spam (${feedbackType})`,
          subscriberId: subscriber.id,
        });
        console.log(
          `Complaint: blocklisted ${recipient.emailAddress} (${feedbackType})`,
        );

        if (sesMessageId) {
          db.update(schema.campaignSends)
            .set({
              status: "complained",
              complaintType: feedbackType,
              updatedAt: now,
            })
            .where(eq(schema.campaignSends.sesMessageId, sesMessageId))
            .run();
        }
      }
    }
  }

  return new Response("OK");
}
