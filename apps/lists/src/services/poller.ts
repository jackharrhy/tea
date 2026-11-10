import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { eq, desc, and } from "drizzle-orm";
import { simpleParser } from "mailparser";
import type { Config } from "../config";
import type { Db } from "../db";
import { schema } from "../db";
import { logEvent } from "./events";
import { awsClientConfig, s3ClientConfig } from "./aws";
import { ingestDmarcEmail } from "./dmarc-ingest";
import { abortableSleep } from "./worker-control";

type SQSPayload = {
  kind?: "reply" | "dmarc";
  messageId: string;
  rfc822MessageId?: string;
  inReplyTo?: string;
  references?: string[];
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
  s3Key?: string;
  action: {
    type: string;
    bucketName: string;
    objectKeyPrefix: string;
    objectKey: string;
  };
};

async function fetchAndParseEmail(
  s3: S3Client,
  bucket: string,
  key: string,
  signal?: AbortSignal,
) {
  const resp = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { abortSignal: signal },
  );
  const bodyBytes = await resp.Body?.transformToByteArray();
  if (!bodyBytes) return null;
  const parsed = await simpleParser(Buffer.from(bodyBytes));
  return parsed;
}

export async function startPoller(
  db: Db,
  config: Config,
  signal?: AbortSignal,
) {
  const sqs = new SQSClient(awsClientConfig(config));
  const s3 = new S3Client(s3ClientConfig(config));
  const queueUrl = config.sqsQueueUrl;

  console.log(`Polling SQS queue: ${queueUrl}`);

  while (true) {
    if (signal?.aborted) break;
    try {
      const resp = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
        }),
        { abortSignal: signal },
      );

      if (!resp.Messages) continue;

      for (const msg of resp.Messages) {
        if (signal?.aborted) break;
        try {
          const payload: SQSPayload = JSON.parse(msg.Body!);
          const s3Key =
            payload.s3Key ||
            payload.action.objectKey ||
            payload.action.objectKeyPrefix + payload.messageId;

          const kind =
            payload.kind ??
            (payload.to.some((address) => /@dmarc\./i.test(address))
              ? "dmarc"
              : "reply");
          if (kind === "dmarc") {
            const parsed = await fetchAndParseEmail(
              s3,
              config.s3Bucket,
              s3Key,
              signal,
            );
            if (!parsed)
              throw new Error(
                `DMARC email body is unavailable in S3 (${s3Key})`,
              );
            const ingestion = ingestDmarcEmail(db, payload, parsed, s3Key);
            console.log(
              `DMARC message ${payload.messageId}: ${ingestion.status}`,
            );
            await sqs.send(
              new DeleteMessageCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: msg.ReceiptHandle,
              }),
              { abortSignal: signal },
            );
            continue;
          }

          // Parse raw email from S3 for body content and reliable headers
          let bodyText: string | null = null;
          let bodyHtml: string | null = null;
          let parsedRfc822MessageId: string | null = null;
          let parsedInReplyTo: string | null = null;

          try {
            const parsed = await fetchAndParseEmail(
              s3,
              config.s3Bucket,
              s3Key,
              signal,
            );
            if (parsed) {
              bodyText = parsed.text ?? null;
              bodyHtml = parsed.html || null;
              // Prefer parsed headers over Lambda payload (more reliable)
              parsedRfc822MessageId = parsed.messageId ?? null;
              parsedInReplyTo = parsed.inReplyTo ?? null;
            }
          } catch (err) {
            if (signal?.aborted) throw err;
            console.error(
              `Failed to fetch/parse email from S3 (${s3Key}):`,
              err,
            );
          }

          // Use parsed values with fallback to Lambda payload
          const rfc822MessageId =
            parsedRfc822MessageId ?? payload.rfc822MessageId ?? null;
          const inReplyTo = parsedInReplyTo ?? payload.inReplyTo ?? null;
          const fromAddr = payload.from[0] ?? payload.source;
          const toAddr = payload.to[0] ?? "";

          // Thread matching
          let parentId: number | null = null;
          let threadId = 0; // will be set to self.id for new thread roots
          let campaignId: number | null = null;

          if (inReplyTo) {
            // Extract the bare ID from angle brackets for SES matching
            // inReplyTo looks like: <id@email.amazonses.com> or <uuid@domain>
            const bareInReplyTo = inReplyTo.replace(/^<|>$/g, "");
            // SES rewrites Message-ID to <sesMessageId@email.amazonses.com>
            // So extract just the part before @ for matching against sesMessageId
            const sesIdFromReply = bareInReplyTo.split("@")[0] ?? "";

            // 1. Check inReplyTo against messages.rfc822MessageId (exact match)
            let parentMsg = db
              .select({
                id: schema.messages.id,
                threadId: schema.messages.threadId,
              })
              .from(schema.messages)
              .where(eq(schema.messages.rfc822MessageId, inReplyTo))
              .get();

            // 2. Check against messages.sesMessageId (SES rewrites Message-ID on delivery)
            if (!parentMsg && sesIdFromReply) {
              parentMsg = db
                .select({
                  id: schema.messages.id,
                  threadId: schema.messages.threadId,
                })
                .from(schema.messages)
                .where(eq(schema.messages.sesMessageId, sesIdFromReply))
                .get();
            }

            if (parentMsg) {
              parentId = parentMsg.id;
              threadId = parentMsg.threadId;
            } else {
              // 3. Check inReplyTo against campaignSends.rfc822MessageId
              let campaignSend = db
                .select({
                  campaignId: schema.campaignSends.campaignId,
                })
                .from(schema.campaignSends)
                .where(eq(schema.campaignSends.rfc822MessageId, inReplyTo))
                .get();

              // 4. Check against campaignSends.sesMessageId
              if (!campaignSend && sesIdFromReply) {
                campaignSend = db
                  .select({
                    campaignId: schema.campaignSends.campaignId,
                  })
                  .from(schema.campaignSends)
                  .where(eq(schema.campaignSends.sesMessageId, sesIdFromReply))
                  .get();
              }

              if (campaignSend) {
                campaignId = campaignSend.campaignId;
                // new thread root — threadId set after insert
              }
            }
          }

          // 5. If no match via inReplyTo, try campaign linkage via reply-to slug
          if (!parentId && !campaignId) {
            for (const toAddress of payload.to) {
              const match = toAddress.match(/^([^@]+)@reply\./);
              if (!match) continue;
              const slug = match[1];
              const list = db
                .select()
                .from(schema.lists)
                .where(eq(schema.lists.slug, slug!))
                .get();
              if (!list) continue;
              // find campaigns that targeted this list
              const campaign = db
                .select()
                .from(schema.campaigns)
                .where(
                  and(
                    eq(schema.campaigns.audienceType, "list"),
                    eq(schema.campaigns.audienceId, list.id),
                    eq(schema.campaigns.status, "sent"),
                  ),
                )
                .orderBy(desc(schema.campaigns.sentAt))
                .get();
              if (campaign) {
                campaignId = campaign.id;
                break;
              }
            }
          }

          // Insert into messages table
          // sesMessageId is the SES internal ID (payload.messageId) — used for dedup
          const inserted = db
            .insert(schema.messages)
            .values({
              threadId,
              parentId,
              direction: "inbound",
              rfc822MessageId,
              inReplyTo,
              fromAddr,
              toAddr,
              subject: payload.subject,
              bodyText,
              bodyHtml,
              sesMessageId: payload.messageId,
              s3Key,
              spamVerdict: payload.spamVerdict,
              virusVerdict: payload.virusVerdict,
              spfVerdict: payload.spfVerdict,
              dkimVerdict: payload.dkimVerdict,
              dmarcVerdict: payload.dmarcVerdict,
              campaignId,
            })
            .onConflictDoNothing({
              target: schema.messages.sesMessageId,
            })
            .returning()
            .get();

          if (inserted) {
            // For new thread roots (threadId === 0), set threadId = self.id
            if (inserted.threadId === 0) {
              db.update(schema.messages)
                .set({ threadId: inserted.id })
                .where(eq(schema.messages.id, inserted.id))
                .run();
            }

            logEvent(db, {
              type: "inbound.received",
              detail: `Inbound from ${fromAddr}: ${payload.subject}`,
              messageId: inserted.id,
              campaignId: campaignId ?? undefined,
            });
          }

          console.log(
            `Stored message ${payload.messageId} from ${fromAddr} (${payload.subject})${campaignId ? ` [campaign ${campaignId}]` : ""}`,
          );

          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: queueUrl,
              ReceiptHandle: msg.ReceiptHandle,
            }),
            { abortSignal: signal },
          );
        } catch (err) {
          if (signal?.aborted) break;
          console.error(`Error processing message ${msg.MessageId}:`, err);
        }
      }
    } catch (err) {
      if (signal?.aborted) break;
      console.error("Error receiving messages from SQS:", err);
      await abortableSleep(5000, signal);
    }
  }
}
