import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { css, type Handle } from "remix/component";
import { createController } from "remix/router";
import { z } from "zod";

import { renderConfirmation } from "../emails/render.ts";
import { canAccessList, getAccessibleListIds, getAccessibleLists } from "../src/auth.ts";
import { buildConfirmUrl } from "../src/compliance.ts";
import type { Config } from "../src/config.ts";
import { schema, type Db } from "../src/db/index.ts";
import { logEvent } from "../src/services/events.ts";
import { sendEmail } from "../src/services/mailer.ts";
import { confirmSubscriber, createSubscriber } from "../src/services/subscriber.ts";
import { AdminDocument, type Viewer } from "./admin.tsx";
import { routes } from "./routes.ts";

type User = Pick<typeof schema.users.$inferSelect, "id" | "role" | "name" | "email">;
type Subscriber = typeof schema.subscribers.$inferSelect;
const PAGE_SIZE = 50;
const heading = css({ fontSize: "24px", lineHeight: "32px", fontWeight: 700, margin: "0 0 20px" });
const toolbar = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  flexWrap: "wrap",
});
const filters = css({
  display: "flex",
  alignItems: "end",
  flexWrap: "wrap",
  gap: "12px",
  marginBottom: "24px",
});
const field = css({ display: "grid", gap: "5px", color: "#4b5563", fontSize: "13px" });
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
  minHeight: "38px",
  padding: "7px 14px",
  border: "1px solid #1f2937",
  borderRadius: "6px",
  backgroundColor: "#1f2937",
  color: "#fff",
  cursor: "pointer",
  font: "inherit",
  fontSize: "14px",
  textDecoration: "none",
});
const link = css({ color: "#1d4ed8", textDecoration: "none" });
const muted = css({ color: "#6b7280", fontSize: "14px" });
const table = css({ width: "100%", borderCollapse: "collapse", fontSize: "14px" });
const cell = css({ padding: "10px 8px", borderBottom: "1px solid #e5e7eb", textAlign: "left" });
const section = css({ margin: "28px 0 12px", fontSize: "18px", fontWeight: 600 });
const form = css({ display: "grid", gap: "16px", maxWidth: "580px" });
const inline = css({ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" });
const notice = css({
  padding: "10px 14px",
  backgroundColor: "#ecfdf5",
  color: "#065f46",
  marginBottom: "18px",
});

function viewer(user: User): Viewer {
  return { name: user.name ?? user.email, isAdmin: user.role !== "member" };
}
function redirect(path: string) {
  return new Response(null, { status: 303, headers: { Location: path } });
}
function id(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}
function visible(db: Db, user: User, subscriberId: number) {
  const access = getAccessibleListIds(db, user);
  return (
    access === "all" ||
    (access.length > 0 &&
      !!db
        .select({ listId: schema.subscriberLists.listId })
        .from(schema.subscriberLists)
        .where(
          and(
            eq(schema.subscriberLists.subscriberId, subscriberId),
            inArray(schema.subscriberLists.listId, access),
          ),
        )
        .get())
  );
}
function requireSubscriber(db: Db, user: User, rawId: string) {
  const subscriberId = id(rawId);
  if (!subscriberId) return { error: new Response("Not Found", { status: 404 }) } as const;
  const subscriber = db
    .select()
    .from(schema.subscribers)
    .where(eq(schema.subscribers.id, subscriberId))
    .get();
  if (!subscriber) return { error: new Response("Not Found", { status: 404 }) } as const;
  if (!visible(db, user, subscriberId))
    return { error: new Response("Forbidden", { status: 403 }) } as const;
  return { subscriber } as const;
}
function subscriberForm(subscriber?: Subscriber) {
  return (
    <>
      <label mix={field}>
        Email
        <input mix={input} type="email" name="email" required value={subscriber?.email ?? ""} />
      </label>
      <label mix={field}>
        First name
        <input mix={input} name="firstName" value={subscriber?.firstName ?? ""} />
      </label>
      <label mix={field}>
        Last name
        <input mix={input} name="lastName" value={subscriber?.lastName ?? ""} />
      </label>
    </>
  );
}
function message(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  return status === "created"
    ? "Subscriber added."
    : status === "saved"
      ? "Subscriber updated."
      : status === "deleted"
        ? "Subscriber deleted."
        : status === "sent"
          ? "Confirmation sent."
          : null;
}
function SubscriberIndex(
  handle: Handle<{
    viewer: Viewer;
    rows: Array<
      Pick<Subscriber, "id" | "email" | "firstName" | "lastName" | "status" | "createdAt"> & {
        membershipCount: number;
      }
    >;
    total: number;
    page: number;
    orphaned: number;
    filters: { search: string; status: string; confirmed: string; membership: string };
    notice: string | null;
  }>,
) {
  return () => {
    const {
      rows,
      viewer: account,
      total,
      page,
      orphaned,
      filters: selected,
      notice: status,
    } = handle.props;
    const query = new URLSearchParams({ ...selected, page: String(page) });
    const pageUrl = (next: number) => {
      query.set("page", String(next));
      return `/admin/subscribers?${query}`;
    };
    return (
      <AdminDocument title="Subscribers" activeHref="/admin/subscribers" viewer={account}>
        {status ? (
          <p mix={notice} role="status">
            {status}
          </p>
        ) : null}
        <div mix={toolbar}>
          <h1 mix={heading}>Subscribers</h1>
          <a mix={button} href="/admin/subscribers/new">
            Add subscriber
          </a>
        </div>
        {orphaned > 0 ? (
          <p mix={muted}>
            <a mix={link} href="/admin/subscribers?membership=orphaned">
              {orphaned} orphaned
            </a>
          </p>
        ) : null}
        <form mix={filters} method="get" action="/admin/subscribers">
          <label mix={field}>
            Search
            <input mix={input} name="search" value={selected.search} placeholder="Email or name" />
          </label>
          <label mix={field}>
            Status
            <select mix={input} name="status">
              <option value="">All</option>
              <option value="active" selected={selected.status === "active"}>
                Active
              </option>
              <option value="blocklisted" selected={selected.status === "blocklisted"}>
                Blocklisted
              </option>
            </select>
          </label>
          {account.isAdmin ? (
            <label mix={field}>
              Membership
              <select mix={input} name="membership">
                <option value="">All</option>
                <option value="orphaned" selected={selected.membership === "orphaned"}>
                  Orphaned
                </option>
              </select>
            </label>
          ) : null}
          <label mix={field}>
            Confirmed
            <select mix={input} name="confirmed">
              <option value="">All</option>
              <option value="confirmed" selected={selected.confirmed === "confirmed"}>
                Confirmed
              </option>
              <option value="unconfirmed" selected={selected.confirmed === "unconfirmed"}>
                Unconfirmed
              </option>
            </select>
          </label>
          <button mix={button} type="submit">
            Filter
          </button>
          <a mix={link} href="/admin/subscribers">
            Clear
          </a>
        </form>
        <table mix={table}>
          <thead>
            <tr>
              <th mix={cell}>Email</th>
              <th mix={cell}>Name</th>
              <th mix={cell}>Status</th>
              <th mix={cell}>Lists</th>
              <th mix={cell}>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((subscriber) => (
              <tr>
                <td mix={cell}>
                  <a mix={link} href={`/admin/subscribers/${subscriber.id}`}>
                    {subscriber.email}
                  </a>
                </td>
                <td mix={cell}>
                  {[subscriber.firstName, subscriber.lastName].filter(Boolean).join(" ") || "—"}
                </td>
                <td mix={cell}>{subscriber.status}</td>
                <td mix={cell}>{subscriber.membershipCount || "Orphaned"}</td>
                <td mix={cell}>{subscriber.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td mix={cell} colSpan={5}>
                  No subscribers match the current filters.
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
function SubscriberNew(
  handle: Handle<{ viewer: Viewer; lists: Array<typeof schema.lists.$inferSelect> }>,
) {
  return () => (
    <AdminDocument
      title="Add subscriber"
      activeHref="/admin/subscribers"
      viewer={handle.props.viewer}
    >
      <h1 mix={heading}>Add subscriber</h1>
      <form mix={form} method="post" action="/admin/subscribers/new">
        {subscriberForm()}
        <label mix={inline}>
          <input type="checkbox" name="skip_confirm" value="1" />
          Pre-confirm list subscriptions
        </label>
        <fieldset>
          <legend>Lists</legend>
          {handle.props.lists.map((list) => (
            <label mix={inline}>
              <input type="checkbox" name="lists" value={list.slug} />
              {list.name}
            </label>
          ))}
        </fieldset>
        <button mix={button} type="submit">
          Add subscriber
        </button>
      </form>
    </AdminDocument>
  );
}
function SubscriberShow(
  handle: Handle<{
    viewer: Viewer;
    subscriber: Subscriber;
    lists: Array<{ id: number; name: string; status: string | null }>;
    tags: Array<{ id: number; name: string; applied: boolean }>;
    events: Array<{ id: number; type: string; detail: string | null; createdAt: string }>;
    sends: Array<{ campaignId: number; status: string; subject: string | null }>;
    notice: string | null;
  }>,
) {
  return () => {
    const {
      viewer: account,
      subscriber,
      lists,
      tags,
      events,
      sends,
      notice: status,
    } = handle.props;
    const base = `/admin/subscribers/${subscriber.id}`;
    return (
      <AdminDocument title={subscriber.email} activeHref="/admin/subscribers" viewer={account}>
        {status ? (
          <p mix={notice} role="status">
            {status}
          </p>
        ) : null}
        <h1 mix={heading}>{subscriber.email}</h1>
        <form mix={form} method="post" action={`${base}/edit`}>
          {subscriberForm(subscriber)}
          <label mix={field}>
            Status
            <select mix={input} name="status">
              <option value="active" selected={subscriber.status === "active"}>
                active
              </option>
              <option value="blocklisted" selected={subscriber.status === "blocklisted"}>
                blocklisted
              </option>
            </select>
          </label>
          <button mix={button} type="submit">
            Save changes
          </button>
        </form>
        <h2 mix={section}>List subscriptions</h2>
        <table mix={table}>
          <thead>
            <tr>
              <th mix={cell}>List</th>
              <th mix={cell}>Status</th>
              <th mix={cell}>Action</th>
            </tr>
          </thead>
          <tbody>
            {lists.map((list) => (
              <tr>
                <td mix={cell}>{list.name}</td>
                <td mix={cell}>{list.status ?? "Not subscribed"}</td>
                <td mix={cell}>
                  {list.status ? (
                    <div mix={inline}>
                      <form method="post" action={`${base}/list/${list.id}/status`}>
                        <select name="listStatus" mix={input}>
                          <option value="unconfirmed" selected={list.status === "unconfirmed"}>
                            Unconfirmed
                          </option>
                          <option value="confirmed" selected={list.status === "confirmed"}>
                            Confirmed
                          </option>
                          <option value="unsubscribed" selected={list.status === "unsubscribed"}>
                            Unsubscribed
                          </option>
                        </select>
                        <button type="submit">Save</button>
                      </form>
                      <form method="post" action={`${base}/list/${list.id}/remove`}>
                        <button type="submit">Remove</button>
                      </form>
                    </div>
                  ) : (
                    <form method="post" action={`${base}/list/${list.id}/add`}>
                      <button type="submit">Add</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lists.some((list) => list.status === "unconfirmed") ? (
          <form method="post" action={`${base}/send-confirm`}>
            <button mix={button} type="submit">
              Send confirmation
            </button>
          </form>
        ) : null}
        <h2 mix={section}>Tags</h2>
        <div mix={inline}>
          {tags
            .filter((tag) => tag.applied)
            .map((tag) => (
              <form method="post" action={`${base}/tags/${tag.id}/remove`}>
                <button type="submit">{tag.name} ×</button>
              </form>
            ))}
        </div>
        {tags.some((tag) => !tag.applied) ? (
          <form method="post" action={`${base}/tags/add`}>
            <select mix={input} name="tagId">
              {tags
                .filter((tag) => !tag.applied)
                .map((tag) => (
                  <option value={String(tag.id)}>{tag.name}</option>
                ))}
            </select>
            <button type="submit">Add tag</button>
          </form>
        ) : null}
        <h2 mix={section}>Send history</h2>
        {sends.length ? (
          <ul>
            {sends.map((send) => (
              <li>
                <a mix={link} href={`/admin/campaigns/${send.campaignId}`}>
                  {send.subject ?? "Campaign"}
                </a>{" "}
                — {send.status}
              </li>
            ))}
          </ul>
        ) : (
          <p mix={muted}>No campaign sends.</p>
        )}
        <h2 mix={section}>Activity</h2>
        {events.length ? (
          <ul>
            {events.map((event) => (
              <li>
                {event.type}: {event.detail} <small>{event.createdAt.slice(0, 16)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p mix={muted}>No activity.</p>
        )}
        <h2 mix={section}>Delete subscriber</h2>
        <form method="post" action={`${base}/delete`}>
          <button type="submit">Delete subscriber and memberships</button>
        </form>
      </AdminDocument>
    );
  };
}

export function createAdminSubscribersController(db: Db, config: Config, user: User) {
  const account = viewer(user);
  function required(rawId: string) {
    return requireSubscriber(db, user, rawId);
  }
  function listMembership(rawId: string, rawListId: string) {
    const subscriber = required(rawId);
    if (subscriber.error) return { error: subscriber.error } as const;
    const listId = id(rawListId);
    if (!listId || !canAccessList(db, user, listId))
      return { error: new Response("Forbidden", { status: 403 }) } as const;
    return { subscriber: subscriber.subscriber, listId } as const;
  }
  return createController(routes.admin.subscribers, {
    actions: {
      index(context) {
        const url = new URL(context.request.url);
        const filters = {
          search: url.searchParams.get("search") ?? "",
          status: url.searchParams.get("status") ?? "",
          confirmed: url.searchParams.get("confirmed") ?? "",
          membership: url.searchParams.get("membership") ?? "",
        };
        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const access = getAccessibleListIds(db, user);
        const conditions = [];
        if (filters.search) {
          const pattern = `%${filters.search}%`;
          conditions.push(
            or(
              like(schema.subscribers.email, pattern),
              like(schema.subscribers.firstName, pattern),
              like(schema.subscribers.lastName, pattern),
            ),
          );
        }
        if (filters.status === "active" || filters.status === "blocklisted")
          conditions.push(eq(schema.subscribers.status, filters.status));
        if (filters.confirmed === "confirmed" || filters.confirmed === "unconfirmed") {
          const exists = sql`EXISTS (SELECT 1 FROM subscriber_lists sl WHERE sl.subscriber_id = ${schema.subscribers.id} AND sl.status = 'confirmed')`;
          conditions.push(filters.confirmed === "confirmed" ? exists : sql`NOT ${exists}`);
        }
        if (access === "all" && filters.membership === "orphaned")
          conditions.push(
            sql`NOT EXISTS (SELECT 1 FROM subscriber_lists sl WHERE sl.subscriber_id = ${schema.subscribers.id})`,
          );
        const accessCondition =
          access === "all"
            ? undefined
            : access.length
              ? sql`EXISTS (SELECT 1 FROM subscriber_lists sl WHERE sl.subscriber_id = ${schema.subscribers.id} AND sl.list_id IN (${sql.join(
                  access.map((item) => sql`${item}`),
                  sql`, `,
                )}) )`
              : sql`0`;
        if (accessCondition) conditions.push(accessCondition);
        const where = conditions.length ? and(...conditions) : undefined;
        const rows = db
          .select({
            id: schema.subscribers.id,
            email: schema.subscribers.email,
            firstName: schema.subscribers.firstName,
            lastName: schema.subscribers.lastName,
            status: schema.subscribers.status,
            createdAt: schema.subscribers.createdAt,
            membershipCount: sql<number>`(SELECT count(*) FROM subscriber_lists sl WHERE sl.subscriber_id = ${schema.subscribers.id})`,
          })
          .from(schema.subscribers)
          .where(where)
          .orderBy(desc(schema.subscribers.createdAt))
          .limit(PAGE_SIZE)
          .offset((page - 1) * PAGE_SIZE)
          .all();
        const total =
          db
            .select({ count: sql<number>`count(*)` })
            .from(schema.subscribers)
            .where(where)
            .get()?.count ?? 0;
        const orphaned =
          access === "all"
            ? (db
                .select({ count: sql<number>`count(*)` })
                .from(schema.subscribers)
                .where(
                  sql`NOT EXISTS (SELECT 1 FROM subscriber_lists sl WHERE sl.subscriber_id = ${schema.subscribers.id})`,
                )
                .get()?.count ?? 0)
            : 0;
        return context.render(
          <SubscriberIndex
            viewer={account}
            rows={rows}
            total={total}
            page={page}
            orphaned={orphaned}
            filters={filters}
            notice={message(context.request)}
          />,
        );
      },
      new(context) {
        return context.render(
          <SubscriberNew viewer={account} lists={getAccessibleLists(db, user)} />,
        );
      },
      async create(context) {
        const data = await context.request.formData();
        const parsed = z
          .object({ email: z.email(), firstName: z.string(), lastName: z.string() })
          .safeParse({
            email: text(data.get("email")).toLowerCase(),
            firstName: text(data.get("firstName")),
            lastName: text(data.get("lastName")),
          });
        if (!parsed.success) return new Response("Invalid subscriber", { status: 400 });
        const allowed = new Map(getAccessibleLists(db, user).map((list) => [list.slug, list]));
        const requested = data.getAll("lists").map(text);
        if (user.role === "member" && requested.length === 0)
          return new Response("Select a list", { status: 400 });
        if (requested.some((slug) => !allowed.has(slug)))
          return new Response("Forbidden", { status: 403 });
        const subscriber = createSubscriber(
          db,
          parsed.data.email,
          parsed.data.firstName || null,
          parsed.data.lastName || null,
          requested,
        );
        if (data.get("skip_confirm") === "1") confirmSubscriber(db, subscriber.unsubscribeToken);
        logEvent(db, {
          type: "admin.subscriber_added",
          detail: subscriber.email,
          subscriberId: subscriber.id,
          userId: user.id,
        });
        return redirect("/admin/subscribers?status=created");
      },
      show(context) {
        const found = required(context.params.id);
        if (found.error) return found.error;
        const subscriber = found.subscriber;
        const memberships = db
          .select()
          .from(schema.subscriberLists)
          .where(eq(schema.subscriberLists.subscriberId, subscriber.id))
          .all();
        const memberStatus = new Map(memberships.map((item) => [item.listId, item.status]));
        const lists = getAccessibleLists(db, user).map((list) => ({
          id: list.id,
          name: list.name,
          status: memberStatus.get(list.id) ?? null,
        }));
        const applied = new Set(
          db
            .select({ tagId: schema.subscriberTags.tagId })
            .from(schema.subscriberTags)
            .where(eq(schema.subscriberTags.subscriberId, subscriber.id))
            .all()
            .map((item) => item.tagId),
        );
        const tags = db
          .select()
          .from(schema.tags)
          .all()
          .map((tag) => ({ id: tag.id, name: tag.name, applied: applied.has(tag.id) }));
        const events = db
          .select({
            id: schema.events.id,
            type: schema.events.type,
            detail: schema.events.detail,
            createdAt: schema.events.createdAt,
          })
          .from(schema.events)
          .where(eq(schema.events.subscriberId, subscriber.id))
          .orderBy(desc(schema.events.createdAt))
          .limit(50)
          .all();
        const sends = db
          .select({
            campaignId: schema.campaignSends.campaignId,
            status: schema.campaignSends.status,
            subject: schema.campaigns.subject,
          })
          .from(schema.campaignSends)
          .leftJoin(schema.campaigns, eq(schema.campaignSends.campaignId, schema.campaigns.id))
          .where(eq(schema.campaignSends.subscriberId, subscriber.id))
          .orderBy(desc(schema.campaignSends.sentAt))
          .all();
        return context.render(
          <SubscriberShow
            viewer={account}
            subscriber={subscriber}
            lists={lists}
            tags={tags}
            events={events}
            sends={sends}
            notice={message(context.request)}
          />,
        );
      },
      async update(context) {
        const found = required(context.params.id);
        if (found.error) return found.error;
        const data = await context.request.formData();
        const parsed = z
          .object({
            email: z.email(),
            firstName: z.string(),
            lastName: z.string(),
            status: z.enum(["active", "blocklisted"]),
          })
          .safeParse({
            email: text(data.get("email")).toLowerCase(),
            firstName: text(data.get("firstName")),
            lastName: text(data.get("lastName")),
            status: text(data.get("status")),
          });
        if (!parsed.success) return new Response("Invalid subscriber", { status: 400 });
        db.update(schema.subscribers)
          .set({
            ...parsed.data,
            firstName: parsed.data.firstName || null,
            lastName: parsed.data.lastName || null,
          })
          .where(eq(schema.subscribers.id, found.subscriber.id))
          .run();
        logEvent(db, {
          type: "admin.subscriber_edited",
          detail: parsed.data.email,
          subscriberId: found.subscriber.id,
          userId: user.id,
        });
        return redirect(`/admin/subscribers/${found.subscriber.id}?status=saved`);
      },
      destroy(context) {
        const found = required(context.params.id);
        if (found.error) return found.error;
        const subscriber = found.subscriber;
        db.transaction((tx) => {
          tx.delete(schema.subscriberLists)
            .where(eq(schema.subscriberLists.subscriberId, subscriber.id))
            .run();
          tx.delete(schema.subscriberTags)
            .where(eq(schema.subscriberTags.subscriberId, subscriber.id))
            .run();
          tx.delete(schema.campaignSends)
            .where(eq(schema.campaignSends.subscriberId, subscriber.id))
            .run();
          tx.update(schema.events)
            .set({ subscriberId: null })
            .where(eq(schema.events.subscriberId, subscriber.id))
            .run();
          tx.delete(schema.subscribers).where(eq(schema.subscribers.id, subscriber.id)).run();
          logEvent(tx, {
            type: "admin.subscriber_deleted",
            detail: subscriber.email,
            meta: { subscriberId: subscriber.id },
            userId: user.id,
          });
        });
        return redirect("/admin/subscribers?status=deleted");
      },
      async sendConfirmation(context) {
        const found = required(context.params.id);
        if (found.error) return found.error;
        const subscriber = found.subscriber;
        const data = await context.request.formData();
        const requestedDomain = text(data.get("domain"));
        const unconfirmed = db
          .select({
            listId: schema.subscriberLists.listId,
            name: schema.lists.name,
            fromDomain: schema.lists.fromDomain,
          })
          .from(schema.subscriberLists)
          .innerJoin(schema.lists, eq(schema.subscriberLists.listId, schema.lists.id))
          .where(
            and(
              eq(schema.subscriberLists.subscriberId, subscriber.id),
              eq(schema.subscriberLists.status, "unconfirmed"),
            ),
          )
          .all()
          .filter(
            (item) =>
              canAccessList(db, user, item.listId) &&
              (!requestedDomain || item.fromDomain === requestedDomain),
          );
        if (!unconfirmed.length) return redirect(`/admin/subscribers/${subscriber.id}`);
        const domain = requestedDomain || unconfirmed[0]!.fromDomain || config.fromDomain;
        const { html } = await renderConfirmation({
          confirmUrl: buildConfirmUrl(config.baseUrl, subscriber.unsubscribeToken, domain),
          listNames: unconfirmed.map((item) => item.name),
        });
        await sendEmail(
          config,
          new SendEmailCommand({
            FromEmailAddress: `noreply@${domain}`,
            Destination: { ToAddresses: [subscriber.email] },
            Content: {
              Simple: {
                Subject: { Data: "Confirm your subscription" },
                Body: { Html: { Data: html } },
              },
            },
            ConfigurationSetName: config.sesConfigSet || undefined,
            EmailTags: [
              { Name: "subscriber_id", Value: String(subscriber.id) },
              { Name: "message_kind", Value: "confirmation" },
            ],
          }).input,
        );
        logEvent(db, {
          type: "admin.confirmation_sent",
          detail: `Confirmation email sent to ${subscriber.email} for ${domain}`,
          subscriberId: subscriber.id,
          userId: user.id,
        });
        return redirect(`/admin/subscribers/${subscriber.id}?status=sent`);
      },
      async addList(context) {
        const target = listMembership(context.params.id, context.params.listId);
        if (target.error) return target.error;
        const data = await context.request.formData();
        const status = z
          .enum(["unconfirmed", "confirmed", "unsubscribed"])
          .safeParse(text(data.get("listStatus")) || "unconfirmed");
        if (!status.success) return new Response("Invalid list status", { status: 400 });
        db.insert(schema.subscriberLists)
          .values({
            subscriberId: target.subscriber.id,
            listId: target.listId,
            status: status.data,
          })
          .onConflictDoNothing()
          .run();
        return redirect(`/admin/subscribers/${target.subscriber.id}`);
      },
      async updateList(context) {
        const target = listMembership(context.params.id, context.params.listId);
        if (target.error) return target.error;
        const data = await context.request.formData();
        const status = z
          .enum(["unconfirmed", "confirmed", "unsubscribed"])
          .safeParse(text(data.get("listStatus")));
        if (!status.success) return new Response("Invalid list status", { status: 400 });
        db.update(schema.subscriberLists)
          .set({ status: status.data })
          .where(
            and(
              eq(schema.subscriberLists.subscriberId, target.subscriber.id),
              eq(schema.subscriberLists.listId, target.listId),
            ),
          )
          .run();
        return redirect(`/admin/subscribers/${target.subscriber.id}`);
      },
      removeList(context) {
        const target = listMembership(context.params.id, context.params.listId);
        if (target.error) return target.error;
        db.delete(schema.subscriberLists)
          .where(
            and(
              eq(schema.subscriberLists.subscriberId, target.subscriber.id),
              eq(schema.subscriberLists.listId, target.listId),
            ),
          )
          .run();
        return redirect(`/admin/subscribers/${target.subscriber.id}`);
      },
      async addTag(context) {
        const found = required(context.params.id);
        if (found.error) return found.error;
        const data = await context.request.formData();
        const tagId = id(text(data.get("tagId")));
        if (!tagId || !db.select().from(schema.tags).where(eq(schema.tags.id, tagId)).get())
          return new Response("Invalid tag", { status: 400 });
        db.insert(schema.subscriberTags)
          .values({ subscriberId: found.subscriber.id, tagId })
          .onConflictDoNothing()
          .run();
        return redirect(`/admin/subscribers/${found.subscriber.id}`);
      },
      removeTag(context) {
        const found = required(context.params.id);
        if (found.error) return found.error;
        const tagId = id(context.params.tagId);
        if (!tagId) return new Response("Not Found", { status: 404 });
        db.delete(schema.subscriberTags)
          .where(
            and(
              eq(schema.subscriberTags.subscriberId, found.subscriber.id),
              eq(schema.subscriberTags.tagId, tagId),
            ),
          )
          .run();
        return redirect(`/admin/subscribers/${found.subscriber.id}`);
      },
    },
  });
}
