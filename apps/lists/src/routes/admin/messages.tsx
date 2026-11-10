/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import type { App } from "../../http";
import {
  eq,
  desc,
  sql,
  and,
  inArray,
  like,
  isNull,
  isNotNull,
} from "drizzle-orm";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import * as nodemailer from "nodemailer";
import type { Db } from "../../db";
import { schema } from "../../db";
import type { Config } from "../../config";
import { getAccessibleListIds } from "../../auth";
import { logEvent } from "../../services/events";
import {
  AdminLayout,
  extractEmail,
  fmtDateTime,
  VerdictChips,
  setFlash,
  getFlash,
  type User,
} from "./layout";
import {
  Button,
  Input,
  LinkButton,
  Select,
  Textarea,
  Label,
  FormGroup,
  Table,
  Th,
  Td,
  PageHeader,
} from "./ui";
import { sendEmail } from "../../services/mailer";
import { s3ClientConfig } from "../../services/aws";

const PAGE_SIZE = 50;

export function mountMessageRoutes(app: App, db: Db, config: Config) {
  app.get("/inbound", (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    const listAccess = getAccessibleListIds(db, user);

    // Query params
    const page = Math.max(1, parseInt(c.query.page ?? "1", 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;
    const filterSearch = c.query.search ?? "";
    const filterRead = c.query.read ?? "";
    const filterCampaign = c.query.campaign ?? "";

    // Build filter conditions for thread root messages
    // Thread roots: parentId IS NULL AND direction = "inbound"
    const baseConditions = [
      eq(schema.messages.direction, "inbound"),
      isNull(schema.messages.parentId),
    ];

    if (filterSearch) {
      baseConditions.push(
        sql`(${like(schema.messages.subject, `%${filterSearch}%`)} OR ${like(schema.messages.fromAddr, `%${filterSearch}%`)})`,
      );
    }
    if (filterRead === "unread") {
      baseConditions.push(isNull(schema.messages.readAt));
    } else if (filterRead === "read") {
      baseConditions.push(isNotNull(schema.messages.readAt));
    }
    if (filterCampaign) {
      const camId = parseInt(filterCampaign, 10);
      if (!isNaN(camId))
        baseConditions.push(eq(schema.messages.campaignId, camId));
    }

    // Fetch thread root messages with pagination
    let rootMessages: (typeof schema.messages.$inferSelect)[];
    let totalCount = 0;

    if (listAccess === "all") {
      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.messages)
        .where(and(...baseConditions))
        .get();
      totalCount = countResult?.count ?? 0;

      rootMessages = db
        .select()
        .from(schema.messages)
        .where(and(...baseConditions))
        .orderBy(desc(schema.messages.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset)
        .all();
    } else if (listAccess.length === 0) {
      rootMessages = [];
      totalCount = 0;
    } else {
      // Members: scope to campaigns on their lists
      // We check if the thread root has a campaignId linked to one of their lists,
      // OR if any message in the thread does. For simplicity, filter root messages
      // that have a campaignId on an accessible list.
      const accessibleCampaignIds = db
        .select({ id: schema.campaigns.id })
        .from(schema.campaigns)
        .where(
          and(
            eq(schema.campaigns.audienceType, "list"),
            inArray(schema.campaigns.audienceId, listAccess),
          ),
        )
        .all()
        .map((r) => r.id);

      if (accessibleCampaignIds.length === 0) {
        rootMessages = [];
        totalCount = 0;
      } else {
        const memberConditions = [
          ...baseConditions,
          inArray(schema.messages.campaignId, accessibleCampaignIds),
        ];
        const countResult = db
          .select({ count: sql<number>`count(*)` })
          .from(schema.messages)
          .where(and(...memberConditions))
          .get();
        totalCount = countResult?.count ?? 0;

        rootMessages = db
          .select()
          .from(schema.messages)
          .where(and(...memberConditions))
          .orderBy(desc(schema.messages.createdAt))
          .limit(PAGE_SIZE)
          .offset(offset)
          .all();
      }
    }

    // Count total messages (inbound + outbound) per thread minus 1 (the root)
    const replyCounts = new Map<number, number>();
    if (rootMessages.length > 0) {
      const threadIds = rootMessages.map((m) => m.threadId);
      const counts = db
        .select({
          threadId: schema.messages.threadId,
          count: sql<number>`count(*)`,
        })
        .from(schema.messages)
        .where(inArray(schema.messages.threadId, threadIds))
        .groupBy(schema.messages.threadId)
        .all();
      for (const row of counts) {
        replyCounts.set(row.threadId, Math.max(0, row.count - 1));
      }
    }

    // Check if any inbound message in a thread is unread
    const threadHasUnread = new Map<number, boolean>();
    if (rootMessages.length > 0) {
      const threadIds = rootMessages.map((m) => m.threadId);
      const unreadMsgs = db
        .select({ threadId: schema.messages.threadId })
        .from(schema.messages)
        .where(
          and(
            inArray(schema.messages.threadId, threadIds),
            eq(schema.messages.direction, "inbound"),
            isNull(schema.messages.readAt),
          ),
        )
        .all();
      for (const row of unreadMsgs) {
        threadHasUnread.set(row.threadId, true);
      }
    }

    // Campaign lookup for linked campaigns
    const campaignMap = new Map<number, string>();
    const campaignIds = [
      ...new Set(
        rootMessages.filter((m) => m.campaignId).map((m) => m.campaignId!),
      ),
    ];
    if (campaignIds.length > 0) {
      const campaigns = db
        .select({ id: schema.campaigns.id, subject: schema.campaigns.subject })
        .from(schema.campaigns)
        .where(inArray(schema.campaigns.id, campaignIds))
        .all();
      for (const cam of campaigns) {
        campaignMap.set(cam.id, cam.subject);
      }
    }

    // All campaigns for filter dropdown
    const allCampaigns = db
      .select({ id: schema.campaigns.id, subject: schema.campaigns.subject })
      .from(schema.campaigns)
      .orderBy(desc(schema.campaigns.createdAt))
      .limit(100)
      .all();

    const hasMore = page * PAGE_SIZE < totalCount;

    function buildUrl(params: Record<string, string | number>) {
      const q = new URLSearchParams({
        ...(filterSearch ? { search: filterSearch } : {}),
        ...(filterRead ? { read: filterRead } : {}),
        ...(filterCampaign ? { campaign: filterCampaign } : {}),
        page: String(page),
        ...params,
      });
      return `/admin/inbound?${q.toString()}`;
    }

    return c.html(
      <AdminLayout title="Inbound" user={user} flash={flash}>
        <PageHeader title="Inbound Messages">
          <span class="text-xs text-gray-400">
            {totalCount} thread{totalCount !== 1 ? "s" : ""}
          </span>
        </PageHeader>

        {/* Filters */}
        <form
          method="get"
          action="/admin/inbound"
          hx-get="/admin/inbound"
          hx-trigger="keyup changed delay:350ms from:input[name='search'], change from:select"
          class="filter-bar flex items-end gap-3 mb-6 flex-wrap"
        >
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">
              Search
            </label>
            <Input
              type="text"
              name="search"
              size="sm"
              value={filterSearch}
              autofocus={!!filterSearch}
              placeholder="Subject or from…"
              class="w-48"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">
              Read
            </label>
            <Select name="read" size="sm">
              <option value="" selected={!filterRead}>
                All
              </option>
              <option value="unread" selected={filterRead === "unread"}>
                Unread
              </option>
              <option value="read" selected={filterRead === "read"}>
                Read
              </option>
            </Select>
          </div>
          {allCampaigns.length > 0 && (
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1">
                Campaign
              </label>
              <Select name="campaign" size="sm">
                <option value="" selected={!filterCampaign}>
                  All
                </option>
                {allCampaigns.map((cam) => (
                  <option
                    value={String(cam.id)}
                    selected={filterCampaign === String(cam.id)}
                  >
                    {cam.subject.slice(0, 40)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <input type="hidden" name="page" value="1" />
          <Button type="submit" size="filter">
            Filter
          </Button>
          {(filterSearch || filterRead || filterCampaign) && (
            <a
              href="/admin/inbound"
              class="text-sm text-gray-500 hover:text-gray-700 no-underline"
            >
              Clear
            </a>
          )}
        </form>

        <Table>
          <thead>
            <tr>
              <Th>From</Th>
              <Th>Subject</Th>
              <Th>Date</Th>
              <Th>Replies</Th>
              <Th>Campaign</Th>
              <Th>Auth</Th>
            </tr>
          </thead>
          <tbody>
            {rootMessages.map((msg) => (
              <tr
                class={threadHasUnread.get(msg.threadId) ? "font-semibold" : ""}
              >
                <Td>{msg.fromAddr}</Td>
                <Td>
                  <a
                    href={`/admin/inbound/${msg.id}`}
                    class="text-blue-600 hover:text-blue-800"
                  >
                    {msg.subject}
                  </a>
                </Td>
                <Td>{fmtDateTime(msg.createdAt)}</Td>
                <Td>{replyCounts.get(msg.threadId) ?? 0}</Td>
                <Td>
                  {(() => {
                    const camId = msg.campaignId;
                    return camId && campaignMap.has(camId) ? (
                      <a
                        href={`/admin/campaigns/${camId}`}
                        class="text-blue-600 hover:text-blue-800 text-xs"
                      >
                        {campaignMap.get(camId)}
                      </a>
                    ) : (
                      <span class="text-gray-400">{"\u2014"}</span>
                    );
                  })()}
                </Td>
                <Td>
                  <VerdictChips
                    spf={msg.spfVerdict}
                    dkim={msg.dkimVerdict}
                    dmarc={msg.dmarcVerdict}
                  />
                </Td>
              </tr>
            ))}
            {rootMessages.length === 0 && (
              <tr>
                <Td class="text-gray-400 text-sm py-4" colspan={6}>
                  No messages match the current filters.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>

        {/* Pagination */}
        {(page > 1 || hasMore) && (
          <div class="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
            <div>
              {page > 1 ? (
                <LinkButton
                  href={buildUrl({ page: page - 1 })}
                  variant="secondary"
                  size="sm"
                >
                  ← Previous
                </LinkButton>
              ) : (
                <span />
              )}
            </div>
            <span class="text-xs text-gray-400">
              Showing {PAGE_SIZE * (page - 1) + 1}–
              {PAGE_SIZE * (page - 1) + rootMessages.length} of {totalCount}
            </span>
            <div>
              {hasMore && (
                <LinkButton
                  href={buildUrl({ page: page + 1 })}
                  variant="secondary"
                  size="sm"
                >
                  Next →
                </LinkButton>
              )}
            </div>
          </div>
        )}
      </AdminLayout>,
    );
  });

  app.get("/inbound/:id", async (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    const id = Number(c.params.id);
    const msg = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, id))
      .get();
    if (!msg) return c.notFound();

    // auto-mark as read
    if (!msg.readAt) {
      db.update(schema.messages)
        .set({ readAt: new Date().toISOString() })
        .where(eq(schema.messages.id, id))
        .run();
    }

    // Get all messages in this thread
    const threadMessages = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.threadId, msg.threadId))
      .orderBy(schema.messages.createdAt)
      .all();

    // Linked campaign (from any message in thread)
    const campaignId = threadMessages.find((m) => m.campaignId)?.campaignId;
    const campaign = campaignId
      ? db
          .select()
          .from(schema.campaigns)
          .where(eq(schema.campaigns.id, campaignId))
          .get()
      : null;

    // Mark all unread inbound messages in thread as read
    for (const m of threadMessages) {
      if (!m.readAt && m.direction === "inbound") {
        db.update(schema.messages)
          .set({ readAt: new Date().toISOString() })
          .where(eq(schema.messages.id, m.id))
          .run();
      }
    }

    return c.html(
      <AdminLayout title={`Inbound: ${msg.subject}`} user={user} flash={flash}>
        <PageHeader title={msg.subject} />
        {campaign && (
          <p class="text-sm text-gray-500 mb-4">
            Campaign:{" "}
            <a
              href={`/admin/campaigns/${campaign.id}`}
              class="text-blue-600 hover:text-blue-800"
            >
              {campaign.subject}
            </a>
          </p>
        )}

        {/* Action toolbar */}
        <div class="flex gap-2 mb-4">
          <form method="post" action={`/admin/inbound/${id}/toggle-read`}>
            <button
              type="submit"
              class="inline-block px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-200 cursor-pointer border border-gray-300"
            >
              Mark as {msg.readAt ? "Unread" : "Read"}
            </button>
          </form>
          <form
            method="post"
            action={`/admin/inbound/${id}/delete`}
            onsubmit="return confirm('Delete this message thread? This cannot be undone.')"
          >
            <button
              type="submit"
              class="inline-block px-3 py-1.5 bg-red-50 text-red-600 text-xs font-medium rounded-md hover:bg-red-100 cursor-pointer border border-red-200"
            >
              Delete
            </button>
          </form>
        </div>

        {/* Thread */}
        {threadMessages.map((m) => {
          if (m.direction === "inbound") {
            return (
              <div class="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                <div class="flex items-baseline justify-between mb-3">
                  <div>
                    <span class="font-medium text-sm">{m.fromAddr}</span>
                    <span class="text-gray-400 text-xs ml-2">
                      {"\u2192"} {m.toAddr}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-400">
                      {fmtDateTime(m.createdAt)}
                    </span>
                    <VerdictChips
                      spf={m.spfVerdict}
                      dkim={m.dkimVerdict}
                      dmarc={m.dmarcVerdict}
                    />
                  </div>
                </div>
                {m.bodyHtml ? (
                  <iframe
                    srcdoc={m.bodyHtml}
                    class="w-full border-0 rounded"
                    style="min-height: 200px;"
                    sandbox="allow-same-origin"
                  />
                ) : m.bodyText ? (
                  <pre class="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {m.bodyText}
                  </pre>
                ) : (
                  <p class="text-gray-400 text-sm italic">
                    Email body not available
                  </p>
                )}
                {m.s3Key && (
                  <a
                    href={`/admin/inbound/${m.id}/raw`}
                    class="text-xs text-gray-400 hover:text-gray-600 mt-2 inline-block"
                  >
                    Download raw .eml
                  </a>
                )}
              </div>
            );
          } else {
            return (
              <div class="bg-blue-50 border border-blue-200 rounded-lg p-5 mb-4">
                <div class="flex items-baseline justify-between mb-3">
                  <div>
                    <span class="font-medium text-sm text-blue-800">
                      {m.fromAddr}
                    </span>
                    <span class="text-blue-400 text-xs ml-1">(You)</span>
                    <span class="text-blue-400 text-xs ml-2">
                      {"\u2192"} {m.toAddr}
                    </span>
                  </div>
                  <span class="text-xs text-gray-400">
                    {fmtDateTime(m.sentAt ?? m.createdAt)}
                  </span>
                </div>
                <pre class="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                  {m.bodyText ?? ""}
                </pre>
              </div>
            );
          }
        })}

        {/* Reply form */}
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-5 mt-2">
          <h3 class="text-sm font-semibold text-gray-700 mt-0 mb-3">Reply</h3>
          <form method="post" action={`/admin/inbound/${id}/reply`}>
            <FormGroup>
              <Label for="fromAddr">From</Label>
              <Input
                type="email"
                id="fromAddr"
                name="fromAddr"
                required
                value={extractEmail(msg.toAddr)}
              />
            </FormGroup>
            <FormGroup>
              <Label for="toAddr">To</Label>
              <Input
                type="email"
                id="toAddr"
                name="toAddr"
                required
                value={extractEmail(msg.fromAddr)}
              />
            </FormGroup>
            <FormGroup>
              <Label for="replySubject">Subject</Label>
              <Input
                type="text"
                id="replySubject"
                name="subject"
                required
                value={
                  msg.subject.startsWith("Re:")
                    ? msg.subject
                    : `Re: ${msg.subject}`
                }
              />
            </FormGroup>
            <FormGroup>
              <Label for="replyBody">Body (plain text)</Label>
              <Textarea
                id="replyBody"
                name="body"
                required
                placeholder="Your reply…"
              />
            </FormGroup>
            <Button type="submit">Send Reply</Button>
          </form>
        </div>
      </AdminLayout>,
    );
  });

  app.post("/inbound/:id/toggle-read", (c) => {
    const id = Number(c.params.id);
    const msg = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, id))
      .get();
    if (!msg) return c.notFound();
    db.update(schema.messages)
      .set({ readAt: msg.readAt ? null : new Date().toISOString() })
      .where(eq(schema.messages.id, id))
      .run();
    return c.redirect(`/admin/inbound/${id}`);
  });

  app.post("/inbound/:id/delete", (c) => {
    const user = c.user as User;
    const id = Number(c.params.id);
    const msg = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, id))
      .get();

    if (msg) {
      db.transaction((tx) => {
        const messageIds = tx
          .select({ id: schema.messages.id })
          .from(schema.messages)
          .where(eq(schema.messages.threadId, msg.threadId))
          .all()
          .map((message) => message.id);
        tx.update(schema.events)
          .set({ messageId: null })
          .where(inArray(schema.events.messageId, messageIds))
          .run();
        tx.delete(schema.messages)
          .where(eq(schema.messages.threadId, msg.threadId))
          .run();
        logEvent(tx, {
          type: "admin.inbound_deleted",
          detail: msg.subject,
          meta: { messageId: id, threadId: msg.threadId },
          userId: user.id,
        });
      });
    }
    setFlash(c, "Message deleted.");
    return c.redirect("/admin/inbound");
  });

  app.get("/inbound/:id/raw", async (c) => {
    const id = Number(c.params.id);
    const msg = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, id))
      .get();
    if (!msg || !msg.s3Key) return c.notFound();

    const s3 = new S3Client(s3ClientConfig(config));
    const command = new GetObjectCommand({
      Bucket: config.s3Bucket,
      Key: msg.s3Key,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 300 });
    return c.redirect(url);
  });

  app.post("/inbound/:id/reply", async (c) => {
    const user = c.user as User;
    const id = Number(c.params.id);
    const msg = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, id))
      .get();
    if (!msg) return c.notFound();

    const body = c.body as Record<string, any>;
    const fromAddr = String(body["fromAddr"] ?? "").trim();
    const toAddr = String(body["toAddr"] ?? "").trim();
    const subject = String(body["subject"] ?? "")
      .replace(/[\r\n]/g, " ")
      .trim();
    const replyBody = String(body["body"] ?? "").trim();

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (
      !fromAddr ||
      !toAddr ||
      !subject ||
      !replyBody ||
      !emailRe.test(fromAddr) ||
      !emailRe.test(toAddr)
    ) {
      return c.redirect(`/admin/inbound/${id}`);
    }

    const inReplyToId = msg.rfc822MessageId;
    const fromDomain = fromAddr.split("@")[1] ?? config.fromDomain;
    const rfc822MessageId = `<${crypto.randomUUID()}@${fromDomain}>`;

    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });
    const info = await transport.sendMail({
      from: fromAddr,
      to: toAddr,
      subject,
      text: replyBody,
      headers: {
        "Message-ID": rfc822MessageId,
        ...(inReplyToId
          ? { "In-Reply-To": inReplyToId, References: inReplyToId }
          : {}),
      },
    });

    const result = await sendEmail(
      config,
      new SendEmailCommand({
        FromEmailAddress: fromAddr,
        Destination: { ToAddresses: [toAddr] },
        Content: {
          Raw: {
            Data: info.message as Buffer,
          },
        },
        ConfigurationSetName: config.sesConfigSet || undefined,
        EmailTags: [
          { Name: "message_kind", Value: "reply" },
          ...(msg.campaignId
            ? [{ Name: "campaign_id", Value: String(msg.campaignId) }]
            : []),
        ],
      }).input,
    );

    db.insert(schema.messages)
      .values({
        direction: "outbound",
        threadId: msg.threadId,
        parentId: id,
        fromAddr,
        toAddr,
        subject,
        bodyText: replyBody,
        rfc822MessageId,
        sesMessageId: result.MessageId ?? null,
        inReplyTo: inReplyToId,
        sentAt: new Date().toISOString(),
      })
      .run();

    logEvent(db, {
      type: "admin.reply_sent",
      detail: toAddr,
      messageId: id,
      userId: user.id,
    });

    setFlash(c, "Reply sent.");
    return c.redirect(`/admin/inbound/${id}`);
  });
}
