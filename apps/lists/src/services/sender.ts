import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { eq, and, inArray } from "drizzle-orm";
import * as nodemailer from "nodemailer";
import { testSubscriberIds } from "./campaign-audience";
import type Mail from "nodemailer/lib/mailer";
import type { Config } from "../config";
import { type Db, schema } from "../db";
import { getConfirmedSubscribers } from "./subscriber";
import {
  buildUnsubscribeUrl,
  buildPreferencesUrl,
  buildListUnsubscribeHeader,
} from "../compliance";
import { renderCampaignMessage } from "./campaign-renderer";
import { logEvent } from "./events";
import { sendEmail } from "./mailer";
import { ShutdownInterruptedError, throwIfAborted } from "./worker-control";

/** Get all active, confirmed subscribers (deduplicated by email) for campaigns with no specific list. */
function getAllActiveConfirmedSubscribers(db: Db) {
  return db
    .selectDistinct({
      id: schema.subscribers.id,
      email: schema.subscribers.email,
      firstName: schema.subscribers.firstName,
      lastName: schema.subscribers.lastName,
      unsubscribeToken: schema.subscribers.unsubscribeToken,
    })
    .from(schema.subscribers)
    .innerJoin(
      schema.subscriberLists,
      eq(schema.subscriberLists.subscriberId, schema.subscribers.id),
    )
    .where(
      and(
        eq(schema.subscribers.status, "active"),
        eq(schema.subscriberLists.status, "confirmed"),
      ),
    )
    .all();
}

function getSubscribersByTag(db: Db, tagId: number) {
  return db
    .selectDistinct({
      id: schema.subscribers.id,
      email: schema.subscribers.email,
      firstName: schema.subscribers.firstName,
      lastName: schema.subscribers.lastName,
      unsubscribeToken: schema.subscribers.unsubscribeToken,
    })
    .from(schema.subscribers)
    .innerJoin(
      schema.subscriberTags,
      eq(schema.subscriberTags.subscriberId, schema.subscribers.id),
    )
    .innerJoin(
      schema.subscriberLists,
      eq(schema.subscriberLists.subscriberId, schema.subscribers.id),
    )
    .where(
      and(
        eq(schema.subscriberTags.tagId, tagId),
        eq(schema.subscribers.status, "active"),
        eq(schema.subscriberLists.status, "confirmed"),
      ),
    )
    .all();
}

function getSubscribersByIds(db: Db, ids: number[]) {
  if (ids.length === 0) return [];
  return db
    .selectDistinct({
      id: schema.subscribers.id,
      email: schema.subscribers.email,
      firstName: schema.subscribers.firstName,
      lastName: schema.subscribers.lastName,
      unsubscribeToken: schema.subscribers.unsubscribeToken,
    })
    .from(schema.subscribers)
    .innerJoin(
      schema.subscriberLists,
      eq(schema.subscriberLists.subscriberId, schema.subscribers.id),
    )
    .where(
      and(
        inArray(schema.subscribers.id, ids),
        eq(schema.subscribers.status, "active"),
        eq(schema.subscriberLists.status, "confirmed"),
      ),
    )
    .all();
}

const streamTransport = nodemailer.createTransport({
  streamTransport: true,
  buffer: true,
});

export async function buildRawEmail({
  from,
  to,
  subject,
  html,
  text,
  fromDomain,
  headers,
}: {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text: string;
  fromDomain: string;
  headers: Record<string, string>;
}): Promise<{ raw: Buffer; messageId: string }> {
  const messageId = `<${crypto.randomUUID()}@${fromDomain}>`;

  // Extract data: URI images and convert to inline CID attachments
  const inlineAttachments: Mail.Attachment[] = [];
  const processedHtml = html?.replace(
    /src="data:(image\/[^;]+);base64,([^"]+)"/g,
    (_match, mimeType, base64Data) => {
      const cid = `img-${crypto.randomUUID().replace(/-/g, "")}@lists`;
      inlineAttachments.push({
        cid,
        contentType: mimeType,
        content: Buffer.from(base64Data, "base64"),
        encoding: "base64",
        contentDisposition: "inline",
      });
      return `src="cid:${cid}"`;
    },
  );

  const info = await streamTransport.sendMail({
    from,
    to,
    subject,
    text,
    html: processedHtml,
    headers: {
      "Message-ID": messageId,
      ...headers,
    },
    attachments: inlineAttachments,
  });

  return { raw: info.message as Buffer, messageId };
}

export async function sendCampaign(
  db: Db,
  config: Config,
  campaignId: number,
  signal = config.shutdownSignal,
) {
  throwIfAborted(signal);
  const campaign = db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .get();
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (!["draft", "failed", "scheduled", "sending"].includes(campaign.status)) {
    throw new Error(
      `Campaign ${campaignId} is ${campaign.status}, must be draft, failed, scheduled, or sending`,
    );
  }

  // Resolve list when audienceType is "list"
  const list =
    campaign.audienceType === "list" && campaign.audienceId
      ? db
          .select()
          .from(schema.lists)
          .where(eq(schema.lists.id, campaign.audienceId))
          .get()
      : null;
  if (campaign.audienceType === "list" && !list) {
    throw new Error(
      `List ${campaign.audienceId} not found for campaign ${campaignId}`,
    );
  }

  db.update(schema.campaigns)
    .set({ status: "sending", lastError: null })
    .where(eq(schema.campaigns.id, campaignId))
    .run();

  logEvent(db, {
    type: "campaign.sending",
    detail: `Campaign "${campaign.subject}" started sending`,
    campaignId,
  });

  const isBatched = !!campaign.batchSize;

  try {
    let subscribers: {
      id: number;
      email: string;
      firstName: string | null;
      lastName: string | null;
      unsubscribeToken: string;
    }[];

    switch (campaign.audienceType) {
      case "list":
        subscribers = getConfirmedSubscribers(db, campaign.audienceId!);
        if (campaign.audienceData) {
          const testIds = new Set(
            testSubscriberIds(campaign.audienceType, campaign.audienceData) ??
              [],
          );
          subscribers = subscribers.filter((subscriber) =>
            testIds.has(subscriber.id),
          );
        }
        break;
      case "tag":
        if (!campaign.audienceId)
          throw new Error("Tag audience requires audienceId");
        subscribers = getSubscribersByTag(db, campaign.audienceId);
        break;
      case "subscribers": {
        if (!campaign.audienceData)
          throw new Error("Subscribers audience requires audienceData");
        const ids = JSON.parse(campaign.audienceData) as number[];
        subscribers = getSubscribersByIds(db, ids);
        break;
      }
      case "all":
        subscribers = getAllActiveConfirmedSubscribers(db);
        break;
      default:
        throw new Error("Unknown audience type");
    }

    const sendErrors: string[] = [];

    // figure out which subscribers already got this (for retries)
    const alreadySent = new Set(
      db
        .select({ subscriberId: schema.campaignSends.subscriberId })
        .from(schema.campaignSends)
        .where(
          and(
            eq(schema.campaignSends.campaignId, campaignId),
            inArray(schema.campaignSends.status, [
              "accepted",
              "delivered",
              "delivery_delayed",
              "sent",
            ]),
          ),
        )
        .all()
        .map((r) => r.subscriberId),
    );

    // For batched campaigns, limit to the next N unsent subscribers
    if (isBatched && campaign.batchSize) {
      subscribers = subscribers
        .filter((s) => !alreadySent.has(s.id))
        .slice(0, campaign.batchSize);
    }

    // Derive per-campaign values depending on whether there's a list
    const emailFromDomain = list
      ? list.fromDomain
      : (campaign.fromAddress.split("@")[1] ?? config.fromDomain);
    const fromLocalPart = campaign.fromAddress.split("@")[0] ?? "noreply";
    const listName = list ? list.name : (campaign.fromName ?? fromLocalPart);
    const replyTo = list
      ? `${list.slug}@reply.${list.fromDomain}`
      : `${fromLocalPart}@reply.${emailFromDomain}`;
    // Display name: explicit fromName > list name > local part of fromAddress
    const displayName = campaign.fromName ?? list?.name ?? fromLocalPart;
    const fromWithName = `"${displayName}" <${campaign.fromAddress}>`;

    for (const subscriber of subscribers) {
      throwIfAborted(signal);
      if (alreadySent.has(subscriber.id)) continue;

      const idempotencyKey = `campaign:${campaignId}:subscriber:${subscriber.id}`;
      let delivery = db
        .select()
        .from(schema.campaignSends)
        .where(eq(schema.campaignSends.idempotencyKey, idempotencyKey))
        .get();
      if (
        delivery?.status === "deferred" &&
        delivery.nextAttemptAt &&
        delivery.nextAttemptAt > new Date().toISOString()
      )
        continue;
      if (
        delivery &&
        [
          "accepted",
          "delivered",
          "delivery_delayed",
          "bounced",
          "complained",
          "sent",
        ].includes(delivery.status)
      )
        continue;

      if (!delivery) {
        delivery = db
          .insert(schema.campaignSends)
          .values({
            campaignId,
            subscriberId: subscriber.id,
            idempotencyKey,
            status: "pending",
            updatedAt: new Date().toISOString(),
          })
          .returning()
          .get();
      }

      const unsubscribeUrl = list
        ? buildUnsubscribeUrl(
            config.baseUrl,
            subscriber.unsubscribeToken,
            list.id,
          )
        : buildUnsubscribeUrl(config.baseUrl, subscriber.unsubscribeToken);
      const preferencesUrl = buildPreferencesUrl(
        config.baseUrl,
        subscriber.unsubscribeToken,
      );
      const listUnsubHeaders = buildListUnsubscribeHeader(unsubscribeUrl);

      const rendered = await renderCampaignMessage(db, {
        campaign,
        subscriber,
        list: { name: listName, slug: list?.slug },
        links: { unsubscribe: unsubscribeUrl, preferences: preferencesUrl },
      });

      const { raw: rawEmail, messageId: rfc822MessageId } = await buildRawEmail(
        {
          from: fromWithName,
          to: subscriber.email,
          subject: rendered.subject,
          html: rendered.html ?? undefined,
          text: rendered.text,
          fromDomain: emailFromDomain,
          headers: {
            ...listUnsubHeaders,
            "Reply-To": replyTo,
          },
        },
      );

      // Mark the attempt immediately before the network call. This keeps the
      // restart-recovery ambiguity window as small as possible.
      const attemptAt = new Date().toISOString();
      db.update(schema.campaignSends)
        .set({
          status: "attempting",
          attemptCount: delivery.attemptCount + 1,
          lastAttemptAt: attemptAt,
          nextAttemptAt: null,
          lastError: null,
          updatedAt: attemptAt,
        })
        .where(eq(schema.campaignSends.id, delivery.id))
        .run();

      try {
        const result = await sendEmail(
          config,
          new SendEmailCommand({
            FromEmailAddress: campaign.fromAddress,
            Destination: { ToAddresses: [subscriber.email] },
            Content: {
              Raw: {
                Data: rawEmail,
              },
            },
            ConfigurationSetName: config.sesConfigSet || undefined,
            EmailTags: [
              { Name: "campaign_id", Value: String(campaignId) },
              { Name: "subscriber_id", Value: String(subscriber.id) },
              ...(list ? [{ Name: "list_id", Value: String(list.id) }] : []),
              { Name: "message_kind", Value: "campaign" },
            ],
          }).input,
          { signal },
        );

        const acceptedAt = new Date().toISOString();
        db.update(schema.campaignSends)
          .set({
            sesMessageId: result.MessageId ?? null,
            rfc822MessageId,
            status: "accepted",
            sentAt: acceptedAt,
            acceptedAt,
            updatedAt: acceptedAt,
          })
          .where(eq(schema.campaignSends.id, delivery.id))
          .run();
      } catch (err) {
        if (
          signal?.aborted ||
          err instanceof ShutdownInterruptedError ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          const interruptedAt = new Date().toISOString();
          db.update(schema.campaignSends)
            .set({
              rfc822MessageId,
              status: "deferred",
              nextAttemptAt: interruptedAt,
              lastError: "Application shutdown interrupted delivery",
              updatedAt: interruptedAt,
            })
            .where(eq(schema.campaignSends.id, delivery.id))
            .run();
          throw new ShutdownInterruptedError();
        }
        const msg = err instanceof Error ? err.message : String(err);
        const metadataStatus =
          typeof err === "object" && err && "$metadata" in err
            ? Number(
                (err as { $metadata?: { httpStatusCode?: number } }).$metadata
                  ?.httpStatusCode,
              )
            : 0;
        const errorName = err instanceof Error ? err.name : "";
        const retryable =
          metadataStatus === 429 ||
          metadataStatus >= 500 ||
          [
            "ThrottlingException",
            "TooManyRequestsException",
            "ServiceUnavailableException",
            "TimeoutError",
          ].includes(errorName);
        const attempts = delivery.attemptCount + 1;
        const willRetry = retryable && attempts < 5;
        const retryAt = willRetry
          ? new Date(
              Date.now() + Math.min(60, 2 ** attempts) * 60_000,
            ).toISOString()
          : null;
        db.update(schema.campaignSends)
          .set({
            rfc822MessageId,
            status: willRetry ? "deferred" : "failed",
            nextAttemptAt: retryAt,
            lastError: msg,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.campaignSends.id, delivery.id))
          .run();
        if (!willRetry) sendErrors.push(`${subscriber.email}: ${msg}`);
        console.error(`Failed to send to ${subscriber.email}: ${msg}`);
      }
    }

    if (sendErrors.length > 0) {
      throw new Error(
        `Campaign delivery failed for ${sendErrors.length} recipient${sendErrors.length === 1 ? "" : "s"}: ${sendErrors.join("; ")}`,
      );
    }

    // For batched campaigns, check if there are more unsent subscribers remaining
    if (isBatched) {
      const sentSoFar = new Set(
        db
          .select({ subscriberId: schema.campaignSends.subscriberId })
          .from(schema.campaignSends)
          .where(
            and(
              eq(schema.campaignSends.campaignId, campaignId),
              inArray(schema.campaignSends.status, [
                "accepted",
                "delivered",
                "delivery_delayed",
                "sent",
              ]),
            ),
          )
          .all()
          .map((r) => r.subscriberId),
      );

      // Re-resolve audience to check for remaining unsent
      let allAudienceIds: number[];
      switch (campaign.audienceType) {
        case "list":
          allAudienceIds = getConfirmedSubscribers(
            db,
            campaign.audienceId!,
          ).map((s) => s.id);
          break;
        case "tag":
          allAudienceIds = getSubscribersByTag(db, campaign.audienceId!).map(
            (s) => s.id,
          );
          break;
        case "subscribers": {
          const ids = JSON.parse(campaign.audienceData!) as number[];
          allAudienceIds = getSubscribersByIds(db, ids).map((s) => s.id);
          break;
        }
        case "all":
          allAudienceIds = getAllActiveConfirmedSubscribers(db).map(
            (s) => s.id,
          );
          break;
        default:
          allAudienceIds = [];
      }

      const remainingCount = allAudienceIds.filter(
        (id) => !sentSoFar.has(id),
      ).length;

      if (remainingCount > 0) {
        const nextAt = new Date(
          Date.now() + (campaign.batchInterval ?? 10) * 60 * 1000,
        ).toISOString();
        db.update(schema.campaigns)
          .set({ status: "scheduled", scheduledAt: nextAt })
          .where(eq(schema.campaigns.id, campaignId))
          .run();
        console.log(
          `Campaign ${campaignId}: sent batch, ${remainingCount} remaining, next at ${nextAt}`,
        );
        return; // don't fall through to mark as "sent"
      }
    }

    const outstanding = db
      .select({ id: schema.campaignSends.id })
      .from(schema.campaignSends)
      .where(
        and(
          eq(schema.campaignSends.campaignId, campaignId),
          inArray(schema.campaignSends.status, [
            "pending",
            "attempting",
            "deferred",
          ]),
        ),
      )
      .all();
    if (outstanding.length > 0) {
      db.update(schema.campaigns)
        .set({ status: "sending" })
        .where(eq(schema.campaigns.id, campaignId))
        .run();
      return;
    }

    db.update(schema.campaigns)
      .set({ status: "sent", sentAt: new Date().toISOString() })
      .where(eq(schema.campaigns.id, campaignId))
      .run();

    logEvent(db, {
      type: "campaign.sent",
      detail: `Campaign "${campaign.subject}" sent`,
      meta: { subscriberCount: subscribers.length },
      campaignId,
    });
  } catch (err) {
    if (err instanceof ShutdownInterruptedError || signal?.aborted) {
      const interruptedAt = new Date().toISOString();
      db.update(schema.campaigns)
        .set({
          status: "scheduled",
          scheduledAt: interruptedAt,
          lastError: "Application shutdown interrupted delivery",
        })
        .where(eq(schema.campaigns.id, campaignId))
        .run();
      throw new ShutdownInterruptedError();
    }
    const msg =
      err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    console.error(`Campaign ${campaignId} failed: ${msg}`);
    db.update(schema.campaigns)
      .set({ status: "failed", lastError: msg })
      .where(eq(schema.campaigns.id, campaignId))
      .run();

    logEvent(db, {
      type: "campaign.failed",
      detail: `Campaign "${campaign.subject}" failed: ${msg}`,
      campaignId,
    });

    throw err;
  }
}
