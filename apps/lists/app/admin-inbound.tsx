import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import * as nodemailer from "nodemailer";
import { css, type Handle, unsafeHTML } from "remix/component";
import { createController } from "remix/router";

import { getAccessibleListIds } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import { schema, type Db } from "../src/db/index.ts";
import { s3ClientConfig } from "../src/services/aws.ts";
import { logEvent } from "../src/services/events.ts";
import { sendEmail } from "../src/services/mailer.ts";
import { AdminDocument, type Viewer } from "./admin.tsx";
import { routes } from "./routes.ts";

type User = Pick<
  typeof schema.users.$inferSelect,
  "id" | "role" | "name" | "email"
>;
type Message = typeof schema.messages.$inferSelect;
const PAGE_SIZE = 50;
const heading = css({
  fontSize: "24px",
  lineHeight: "32px",
  fontWeight: 700,
  margin: "0 0 20px",
});
const toolbar = css({
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
  alignItems: "end",
  marginBottom: "20px",
});
const field = css({
  display: "grid",
  gap: "5px",
  color: "#4b5563",
  fontSize: "13px",
});
const input = css({
  boxSizing: "border-box",
  minHeight: "38px",
  padding: "7px 10px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  backgroundColor: "#fff",
  color: "#111827",
  font: "inherit",
  fontSize: "14px",
});
const button = css({
  padding: "7px 14px",
  minHeight: "36px",
  border: "1px solid #1f2937",
  borderRadius: "6px",
  backgroundColor: "#1f2937",
  color: "#fff",
  font: "inherit",
  fontSize: "14px",
  cursor: "pointer",
});
const table = css({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
});
const cell = css({
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  textAlign: "left",
});
const link = css({ color: "#1d4ed8", textDecoration: "none" });
const muted = css({ color: "#6b7280", fontSize: "14px" });
const section = css({
  fontSize: "18px",
  fontWeight: 600,
  margin: "28px 0 12px",
});
const messageBox = css({
  padding: "16px",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  backgroundColor: "#fff",
  marginBottom: "16px",
});
const pre = css({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  fontFamily: "inherit",
  lineHeight: 1.6,
});
const htmlFrame = css({
  boxSizing: "border-box",
  width: "100%",
  minHeight: "240px",
  border: 0,
  backgroundColor: "#fff",
});
const replyForm = css({ display: "grid", gap: "12px", maxWidth: "680px" });
const area = css({
  boxSizing: "border-box",
  minHeight: "150px",
  padding: "7px 10px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  backgroundColor: "#fff",
  color: "#111827",
  font: "inherit",
  fontSize: "14px",
});
const inline = css({
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
});

function viewer(user: User): Viewer {
  return { name: user.name ?? user.email, isAdmin: user.role !== "member" };
}
function id(raw: string) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}
function emailAddress(value: string) {
  return value.match(/<([^>]+)>/)?.[1] ?? value.trim();
}
function redirect(path: string) {
  return new Response(null, { status: 303, headers: { Location: path } });
}

function InboundIndex(
  handle: Handle<{
    viewer: Viewer;
    messages: Message[];
    total: number;
    page: number;
    filters: { search: string; read: string; campaign: string };
  }>,
) {
  return () => {
    const { messages, total, page, filters } = handle.props;
    const query = new URLSearchParams({ ...filters, page: String(page) });
    const pageUrl = (next: number) => {
      query.set("page", String(next));
      return `/admin/inbound?${query}`;
    };
    return (
      <AdminDocument
        title="Inbound"
        activeHref="/admin/inbound"
        viewer={handle.props.viewer}
      >
        <h1 mix={heading}>Inbound mail</h1>
        <form mix={toolbar} method="get" action="/admin/inbound">
          <label mix={field}>
            Search
            <input
              mix={input}
              name="search"
              value={filters.search}
              placeholder="Subject or sender"
            />
          </label>
          <label mix={field}>
            Read
            <select mix={input} name="read">
              <option value="">All</option>
              <option value="unread" selected={filters.read === "unread"}>
                Unread
              </option>
              <option value="read" selected={filters.read === "read"}>
                Read
              </option>
            </select>
          </label>
          <label mix={field}>
            Campaign ID
            <input
              mix={input}
              name="campaign"
              inputMode="numeric"
              value={filters.campaign}
            />
          </label>
          <button mix={button} type="submit">
            Filter
          </button>
          <a mix={link} href="/admin/inbound">
            Clear
          </a>
        </form>
        <table mix={table}>
          <thead>
            <tr>
              <th mix={cell}>Subject</th>
              <th mix={cell}>From</th>
              <th mix={cell}>Received</th>
              <th mix={cell}>State</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr>
                <td mix={cell}>
                  <a mix={link} href={`/admin/inbound/${message.id}`}>
                    {message.subject || "(no subject)"}
                  </a>
                </td>
                <td mix={cell}>{message.fromAddr}</td>
                <td mix={cell}>{message.createdAt.slice(0, 16)}</td>
                <td mix={cell}>{message.readAt ? "Read" : "Unread"}</td>
              </tr>
            ))}
            {messages.length === 0 ? (
              <tr>
                <td mix={cell} colSpan={4}>
                  No inbound messages match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {total > PAGE_SIZE ? (
          <p mix={inline}>
            {page > 1 ? (
              <a mix={link} href={pageUrl(page - 1)}>
                Previous
              </a>
            ) : null}
            <span>
              Page {page} of {Math.ceil(total / PAGE_SIZE)}
            </span>
            {page * PAGE_SIZE < total ? (
              <a mix={link} href={pageUrl(page + 1)}>
                Next
              </a>
            ) : null}
          </p>
        ) : null}
      </AdminDocument>
    );
  };
}
function InboundThread(
  handle: Handle<{
    viewer: Viewer;
    root: Message;
    thread: Message[];
    campaign: { id: number; subject: string } | null;
  }>,
) {
  return () => {
    const { root, thread, campaign } = handle.props;
    const base = `/admin/inbound/${root.id}`;
    return (
      <AdminDocument
        title={root.subject || "Inbound"}
        activeHref="/admin/inbound"
        viewer={handle.props.viewer}
      >
        <a mix={link} href="/admin/inbound">
          ← Inbound
        </a>
        <h1 mix={heading}>{root.subject || "(no subject)"}</h1>
        {campaign ? (
          <p mix={muted}>
            Campaign:{" "}
            <a mix={link} href={`/admin/campaigns/${campaign.id}`}>
              {campaign.subject}
            </a>
          </p>
        ) : null}
        <div mix={inline}>
          <form method="post" action={`${base}/toggle-read`}>
            <button type="submit">
              Mark as {root.readAt ? "unread" : "read"}
            </button>
          </form>
          <form method="post" action={`${base}/delete`}>
            <button type="submit">Delete thread</button>
          </form>
        </div>
        <h2 mix={section}>Thread</h2>
        {thread.map((message) => (
          <article mix={messageBox}>
            <p mix={muted}>
              {message.direction === "inbound" ? "From" : "To"}:{" "}
              {message.direction === "inbound"
                ? message.fromAddr
                : message.toAddr}{" "}
              · {message.createdAt.slice(0, 16)}
            </p>
            <p>
              <strong>{message.subject}</strong>
            </p>
            {message.bodyHtml && message.direction === "inbound" ? (
              <iframe
                mix={htmlFrame}
                title={`Message from ${message.fromAddr}`}
                sandbox=""
                srcDoc={unsafeHTML(message.bodyHtml)}
              />
            ) : (
              <p mix={pre}>{message.bodyText || "(no plain text body)"}</p>
            )}
            {message.direction === "inbound" ? (
              <p mix={muted}>
                SPF {message.spfVerdict || "—"} · DKIM{" "}
                {message.dkimVerdict || "—"} · DMARC{" "}
                {message.dmarcVerdict || "—"}
              </p>
            ) : null}
            {message.s3Key ? (
              <a mix={link} href={`/admin/inbound/${message.id}/raw`}>
                Download raw message
              </a>
            ) : null}
          </article>
        ))}
        <h2 mix={section}>Reply</h2>
        <form mix={replyForm} method="post" action={`${base}/reply`}>
          <label mix={field}>
            From
            <input
              mix={input}
              type="email"
              name="fromAddr"
              value={emailAddress(root.toAddr)}
              required
            />
          </label>
          <label mix={field}>
            To
            <input
              mix={input}
              type="email"
              name="toAddr"
              value={emailAddress(root.fromAddr)}
              required
            />
          </label>
          <label mix={field}>
            Subject
            <input
              mix={input}
              name="subject"
              value={
                root.subject.startsWith("Re:")
                  ? root.subject
                  : `Re: ${root.subject}`
              }
              required
            />
          </label>
          <label mix={field}>
            Message
            <textarea mix={area} name="body" required />
          </label>
          <button mix={button} type="submit">
            Send reply
          </button>
        </form>
      </AdminDocument>
    );
  };
}

export function createAdminInboundController(
  db: Db,
  config: Config,
  user: User,
) {
  const access = getAccessibleListIds(db, user);
  const allowedCampaignIds =
    access === "all"
      ? null
      : db
          .select({ id: schema.campaigns.id })
          .from(schema.campaigns)
          .where(
            and(
              eq(schema.campaigns.audienceType, "list"),
              inArray(
                schema.campaigns.audienceId,
                access.length ? access : [-1],
              ),
            ),
          )
          .all()
          .map((campaign) => campaign.id);
  function getVisible(raw: string) {
    const messageId = id(raw);
    if (!messageId)
      return { error: new Response("Not Found", { status: 404 }) } as const;
    const message = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .get();
    if (!message)
      return { error: new Response("Not Found", { status: 404 }) } as const;
    if (
      allowedCampaignIds &&
      (!message.campaignId || !allowedCampaignIds.includes(message.campaignId))
    )
      return { error: new Response("Forbidden", { status: 403 }) } as const;
    return { message } as const;
  }
  return createController(routes.admin.inbound, {
    actions: {
      index(context) {
        const query = context.url.searchParams;
        const page = Math.max(1, Number(query.get("page")) || 1);
        const filters = {
          search: query.get("search") ?? "",
          read: query.get("read") ?? "",
          campaign: query.get("campaign") ?? "",
        };
        const where = [
          eq(schema.messages.direction, "inbound"),
          isNull(schema.messages.parentId),
        ];
        if (filters.search)
          where.push(
            or(
              like(schema.messages.subject, `%${filters.search}%`),
              like(schema.messages.fromAddr, `%${filters.search}%`),
            )!,
          );
        if (filters.read === "unread")
          where.push(isNull(schema.messages.readAt));
        if (filters.read === "read")
          where.push(isNotNull(schema.messages.readAt));
        const campaignId = id(filters.campaign);
        if (campaignId) where.push(eq(schema.messages.campaignId, campaignId));
        if (allowedCampaignIds)
          where.push(
            inArray(
              schema.messages.campaignId,
              allowedCampaignIds.length ? allowedCampaignIds : [-1],
            ),
          );
        const condition = and(...where);
        const messages = db
          .select()
          .from(schema.messages)
          .where(condition)
          .orderBy(desc(schema.messages.createdAt))
          .limit(PAGE_SIZE)
          .offset((page - 1) * PAGE_SIZE)
          .all();
        const total =
          db
            .select({ count: sql<number>`count(*)` })
            .from(schema.messages)
            .where(condition)
            .get()?.count ?? 0;
        return context.render(
          <InboundIndex
            viewer={viewer(user)}
            messages={messages}
            total={total}
            page={page}
            filters={filters}
          />,
        );
      },
      show(context) {
        const found = getVisible(context.params.id);
        if (found.error) return found.error;
        const root = found.message;
        const thread = db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.threadId, root.threadId))
          .orderBy(schema.messages.createdAt)
          .all();
        const campaign = root.campaignId
          ? (db
              .select({
                id: schema.campaigns.id,
                subject: schema.campaigns.subject,
              })
              .from(schema.campaigns)
              .where(eq(schema.campaigns.id, root.campaignId))
              .get() ?? null)
          : null;
        const now = new Date().toISOString();
        for (const message of thread)
          if (message.direction === "inbound" && !message.readAt)
            db.update(schema.messages)
              .set({ readAt: now })
              .where(eq(schema.messages.id, message.id))
              .run();
        return context.render(
          <InboundThread
            viewer={viewer(user)}
            root={{ ...root, readAt: now }}
            thread={thread}
            campaign={campaign}
          />,
        );
      },
      toggleRead(context) {
        const found = getVisible(context.params.id);
        if (found.error) return found.error;
        db.update(schema.messages)
          .set({
            readAt: found.message.readAt ? null : new Date().toISOString(),
          })
          .where(eq(schema.messages.id, found.message.id))
          .run();
        return redirect(`/admin/inbound/${found.message.id}`);
      },
      destroy(context) {
        const found = getVisible(context.params.id);
        if (found.error) return found.error;
        const message = found.message;
        db.transaction((tx) => {
          const ids = tx
            .select({ id: schema.messages.id })
            .from(schema.messages)
            .where(eq(schema.messages.threadId, message.threadId))
            .all()
            .map((item) => item.id);
          if (ids.length)
            tx.update(schema.events)
              .set({ messageId: null })
              .where(inArray(schema.events.messageId, ids))
              .run();
          tx.delete(schema.messages)
            .where(eq(schema.messages.threadId, message.threadId))
            .run();
          logEvent(tx, {
            type: "admin.inbound_deleted",
            detail: message.subject,
            meta: { messageId: message.id, threadId: message.threadId },
            userId: user.id,
          });
        });
        return redirect("/admin/inbound");
      },
      async raw(context) {
        const found = getVisible(context.params.id);
        if (found.error) return found.error;
        if (!found.message.s3Key)
          return new Response("Not Found", { status: 404 });
        const client = new S3Client(s3ClientConfig(config));
        try {
          const url = await getSignedUrl(
            client,
            new GetObjectCommand({
              Bucket: config.s3Bucket,
              Key: found.message.s3Key,
            }),
            { expiresIn: 300 },
          );
          return new Response(null, {
            status: 302,
            headers: { Location: url },
          });
        } finally {
          client.destroy();
        }
      },
      async reply(context) {
        const found = getVisible(context.params.id);
        if (found.error) return found.error;
        const message = found.message;
        const data = await context.request.formData();
        const fromAddr = text(data, "fromAddr");
        const toAddr = text(data, "toAddr");
        const subject = text(data, "subject").replace(/[\r\n]/g, " ");
        const body = text(data, "body");
        const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email.test(fromAddr) || !email.test(toAddr) || !subject || !body)
          return new Response("Invalid reply", { status: 400 });
        const inReplyTo = message.rfc822MessageId;
        const rfc822MessageId = `<${crypto.randomUUID()}@${fromAddr.split("@")[1] ?? config.fromDomain}>`;
        const transport = nodemailer.createTransport({
          streamTransport: true,
          buffer: true,
        });
        const info = await transport.sendMail({
          from: fromAddr,
          to: toAddr,
          subject,
          text: body,
          headers: {
            "Message-ID": rfc822MessageId,
            ...(inReplyTo
              ? { "In-Reply-To": inReplyTo, References: inReplyTo }
              : {}),
          },
        });
        const result = await sendEmail(
          config,
          new SendEmailCommand({
            FromEmailAddress: fromAddr,
            Destination: { ToAddresses: [toAddr] },
            Content: { Raw: { Data: info.message as Buffer } },
            ConfigurationSetName: config.sesConfigSet || undefined,
            EmailTags: [
              { Name: "message_kind", Value: "reply" },
              ...(message.campaignId
                ? [{ Name: "campaign_id", Value: String(message.campaignId) }]
                : []),
            ],
          }).input,
        );
        db.insert(schema.messages)
          .values({
            direction: "outbound",
            threadId: message.threadId,
            parentId: message.id,
            fromAddr,
            toAddr,
            subject,
            bodyText: body,
            rfc822MessageId,
            sesMessageId: result.MessageId ?? null,
            inReplyTo,
            sentAt: new Date().toISOString(),
          })
          .run();
        logEvent(db, {
          type: "admin.reply_sent",
          detail: toAddr,
          messageId: message.id,
          userId: user.id,
        });
        return redirect(`/admin/inbound/${message.id}`);
      },
    },
  });
}
