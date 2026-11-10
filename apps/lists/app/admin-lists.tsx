import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { css, type Handle } from "remix/component";
import { createController } from "remix/router";

import { canAccessList, getAccessibleLists } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import { schema, type Db } from "../src/db/index.ts";
import { logEvent } from "../src/services/events.ts";
import { AdminDocument, type Viewer } from "./admin.tsx";
import { routes } from "./routes.ts";

type User = Pick<
  typeof schema.users.$inferSelect,
  "id" | "role" | "name" | "email"
>;
type List = typeof schema.lists.$inferSelect;
type SubscriberRow = {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  subscribedAt: string | null;
};
type CampaignRow = Pick<
  typeof schema.campaigns.$inferSelect,
  "id" | "subject" | "status" | "sentAt"
>;

const headingRow = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  marginBottom: "20px",
});
const heading = css({ fontSize: "24px", fontWeight: 650, margin: 0 });
const section = css({
  fontSize: "20px",
  fontWeight: 600,
  margin: "28px 0 12px",
});
const actionStyles = {
  display: "inline-block",
  padding: "8px 14px",
  border: "1px solid #1f2937",
  borderRadius: "6px",
  backgroundColor: "#1f2937",
  color: "#fff",
  textDecoration: "none",
  font: "inherit",
  fontSize: "14px",
  cursor: "pointer",
} as const;
const action = css(actionStyles);
const danger = css({
  ...actionStyles,
  backgroundColor: "#b91c1c",
  borderColor: "#b91c1c",
});
const textLink = css({ color: "#2563eb", textDecoration: "none" });
const muted = css({ color: "#6b7280", fontSize: "14px" });
const table = css({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
});
const cellStyles = {
  padding: "12px 8px",
  borderBottom: "1px solid #e5e7eb",
  textAlign: "left",
} as const;
const cell = css(cellStyles);
const tableHead = css({ ...cellStyles, color: "#4b5563", fontWeight: 500 });
const field = css({
  display: "grid",
  gap: "6px",
  marginBottom: "16px",
  fontSize: "14px",
});
const input = css({
  boxSizing: "border-box",
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  backgroundColor: "#fff",
  color: "#111827",
  font: "inherit",
});
const form = css({ maxWidth: "560px" });
const notice = css({
  marginBottom: "20px",
  padding: "12px 16px",
  backgroundColor: "#ecfdf5",
  color: "#065f46",
});

function toViewer(user: User): Viewer {
  return { name: user.name ?? user.email, isAdmin: user.role !== "member" };
}

function message(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  return status === "created"
    ? "List created."
    : status === "saved"
      ? "List saved."
      : status === "deleted"
        ? "List deleted."
        : null;
}

function redirect(location: string) {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function forbidden() {
  return new Response("Forbidden", { status: 403 });
}

function parseId(value: string) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function readListForm(request: Request, fallbackDomain: string) {
  const data = await request.formData();
  const slug = String(data.get("slug") ?? "").trim();
  const name = String(data.get("name") ?? "").trim();
  const description = String(data.get("description") ?? "").trim();
  const fromDomain =
    String(data.get("fromDomain") ?? "").trim() || fallbackDomain;
  const fromAddress = String(data.get("fromAddress") ?? "").trim();
  if (!slug || !name || !fromDomain || slug.length > 255 || name.length > 255)
    return null;
  return { slug, name, description, fromDomain, fromAddress };
}

function ListIndex(
  handle: Handle<{
    viewer: Viewer;
    lists: Array<{
      id: number;
      slug: string;
      name: string;
      fromDomain: string;
      subscribers: number;
    }>;
    message: string | null;
  }>,
) {
  return () => (
    <AdminDocument
      title="Lists"
      activeHref="/admin/lists"
      viewer={handle.props.viewer}
    >
      {handle.props.message ? (
        <p mix={notice} role="status">
          {handle.props.message}
        </p>
      ) : null}
      <div mix={headingRow}>
        <h1 mix={heading}>Lists</h1>
        {handle.props.viewer.isAdmin ? (
          <a mix={action} href="/admin/lists/new">
            New list
          </a>
        ) : null}
      </div>
      <table mix={table}>
        <thead>
          <tr>
            <th mix={tableHead}>Slug</th>
            <th mix={tableHead}>Name</th>
            <th mix={tableHead}>Domain</th>
            <th mix={tableHead}>Subscribers</th>
          </tr>
        </thead>
        <tbody>
          {handle.props.lists.map((list) => (
            <tr>
              <td mix={cell}>
                <a mix={textLink} href={`/admin/lists/${list.id}`}>
                  {list.slug}
                </a>
              </td>
              <td mix={cell}>{list.name}</td>
              <td mix={cell}>{list.fromDomain}</td>
              <td mix={cell}>{list.subscribers}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {handle.props.lists.length === 0 ? (
        <p mix={muted}>No lists available.</p>
      ) : null}
    </AdminDocument>
  );
}

function ListFields(handle: Handle<{ list?: List; fromDomain: string }>) {
  return () => (
    <>
      <label mix={field}>
        Slug
        <input
          mix={input}
          name="slug"
          required
          defaultValue={handle.props.list?.slug ?? ""}
        />
      </label>
      <label mix={field}>
        Name
        <input
          mix={input}
          name="name"
          required
          defaultValue={handle.props.list?.name ?? ""}
        />
      </label>
      <label mix={field}>
        Description
        <input
          mix={input}
          name="description"
          defaultValue={handle.props.list?.description ?? ""}
        />
      </label>
      <label mix={field}>
        Sending domain
        <input
          mix={input}
          name="fromDomain"
          required
          defaultValue={
            handle.props.list?.fromDomain ?? handle.props.fromDomain
          }
        />
      </label>
      <label mix={field}>
        Default from address
        <input
          mix={input}
          type="email"
          name="fromAddress"
          defaultValue={handle.props.list?.fromAddress ?? ""}
        />
      </label>
    </>
  );
}

function NewList(handle: Handle<{ viewer: Viewer; fromDomain: string }>) {
  return () => (
    <AdminDocument
      title="New list"
      activeHref="/admin/lists"
      viewer={handle.props.viewer}
    >
      <h1 mix={heading}>New list</h1>
      <form mix={form} method="post" action="/admin/lists/new">
        <ListFields fromDomain={handle.props.fromDomain} />
        <button mix={action} type="submit">
          Create list
        </button>
      </form>
    </AdminDocument>
  );
}

function subscriberName(row: SubscriberRow) {
  return [row.firstName, row.lastName].filter(Boolean).join(" ") || "—";
}

function date(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
}

function SubscriberTable(handle: Handle<{ rows: SubscriberRow[] }>) {
  return () => (
    <table mix={table}>
      <thead>
        <tr>
          <th mix={tableHead}>Email</th>
          <th mix={tableHead}>Name</th>
          <th mix={tableHead}>Subscribed</th>
        </tr>
      </thead>
      <tbody>
        {handle.props.rows.map((row) => (
          <tr>
            <td mix={cell}>
              <a mix={textLink} href={`/admin/subscribers/${row.id}`}>
                {row.email}
              </a>
            </td>
            <td mix={cell}>{subscriberName(row)}</td>
            <td mix={cell}>{date(row.subscribedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ListDetail(
  handle: Handle<{
    viewer: Viewer;
    list: List;
    confirmed: SubscriberRow[];
    pending: SubscriberRow[];
    campaigns: CampaignRow[];
    fromDomain: string;
    message: string | null;
  }>,
) {
  return () => {
    const { list, confirmed, pending, campaigns, viewer, fromDomain } =
      handle.props;
    return (
      <AdminDocument
        title={list.name}
        activeHref="/admin/lists"
        viewer={viewer}
      >
        {handle.props.message ? (
          <p mix={notice} role="status">
            {handle.props.message}
          </p>
        ) : null}
        <h1 mix={heading}>{list.name}</h1>
        <form mix={form} method="post" action={`/admin/lists/${list.id}/edit`}>
          <ListFields list={list} fromDomain={fromDomain} />
          <button mix={action} type="submit">
            Save changes
          </button>
        </form>
        <h2 mix={section}>Confirmed subscribers ({confirmed.length})</h2>
        {confirmed.length ? (
          <SubscriberTable rows={confirmed} />
        ) : (
          <p mix={muted}>No confirmed subscribers.</p>
        )}
        {pending.length ? (
          <>
            <h2 mix={section}>Pending confirmation ({pending.length})</h2>
            <SubscriberTable rows={pending} />
          </>
        ) : null}
        {campaigns.length ? (
          <>
            <h2 mix={section}>Campaigns ({campaigns.length})</h2>
            <table mix={table}>
              <thead>
                <tr>
                  <th mix={tableHead}>Subject</th>
                  <th mix={tableHead}>Status</th>
                  <th mix={tableHead}>Sent</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr>
                    <td mix={cell}>
                      <a
                        mix={textLink}
                        href={`/admin/campaigns/${campaign.id}`}
                      >
                        {campaign.subject}
                      </a>
                    </td>
                    <td mix={cell}>{campaign.status}</td>
                    <td mix={cell}>{date(campaign.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
        {viewer.isAdmin ? (
          <details>
            <summary>Delete list</summary>
            <form method="post" action={`/admin/lists/${list.id}/delete`}>
              <p>
                Subscribers will be unlinked, and campaigns on this list will be
                deleted.
              </p>
              <button mix={danger} type="submit">
                Delete list
              </button>
            </form>
          </details>
        ) : null}
      </AdminDocument>
    );
  };
}

export function createAdminListsController(db: Db, config: Config, user: User) {
  const isAdmin = user.role !== "member";
  const currentViewer = toViewer(user);
  return createController(routes.admin.lists, {
    actions: {
      index(context) {
        const lists = getAccessibleLists(db, user).map((list) => ({
          id: list.id,
          slug: list.slug,
          name: list.name,
          fromDomain: list.fromDomain,
          subscribers:
            db
              .select({ count: sql<number>`count(*)` })
              .from(schema.subscriberLists)
              .where(
                and(
                  eq(schema.subscriberLists.listId, list.id),
                  eq(schema.subscriberLists.status, "confirmed"),
                ),
              )
              .get()?.count ?? 0,
        }));
        return context.render(
          <ListIndex
            viewer={currentViewer}
            lists={lists}
            message={message(context.request)}
          />,
        );
      },
      new(context) {
        return isAdmin
          ? context.render(
              <NewList viewer={currentViewer} fromDomain={config.fromDomain} />,
            )
          : forbidden();
      },
      async create(context) {
        if (!isAdmin) return forbidden();
        const values = await readListForm(context.request, config.fromDomain);
        if (!values) return new Response("Invalid list", { status: 400 });
        db.insert(schema.lists).values(values).run();
        logEvent(db, {
          type: "admin.list_created",
          detail: `${values.name} (${values.slug})`,
          userId: user.id,
        });
        return redirect("/admin/lists?status=created");
      },
      show(context) {
        const id = parseId(context.params.id);
        if (!id) return new Response("Bad Request", { status: 400 });
        if (!canAccessList(db, user, id)) return forbidden();
        const list = db
          .select()
          .from(schema.lists)
          .where(eq(schema.lists.id, id))
          .get();
        if (!list) return new Response("Not Found", { status: 404 });
        const subscribers = db
          .select({
            id: schema.subscribers.id,
            email: schema.subscribers.email,
            firstName: schema.subscribers.firstName,
            lastName: schema.subscribers.lastName,
            subscribedAt: schema.subscriberLists.subscribedAt,
            status: schema.subscriberLists.status,
          })
          .from(schema.subscriberLists)
          .innerJoin(
            schema.subscribers,
            eq(schema.subscriberLists.subscriberId, schema.subscribers.id),
          )
          .where(eq(schema.subscriberLists.listId, id))
          .all();
        const campaigns = db
          .select({
            id: schema.campaigns.id,
            subject: schema.campaigns.subject,
            status: schema.campaigns.status,
            sentAt: schema.campaigns.sentAt,
          })
          .from(schema.campaigns)
          .where(
            and(
              eq(schema.campaigns.audienceType, "list"),
              eq(schema.campaigns.audienceId, id),
            ),
          )
          .orderBy(desc(schema.campaigns.createdAt))
          .all();
        return context.render(
          <ListDetail
            viewer={currentViewer}
            list={list}
            confirmed={subscribers.filter((row) => row.status === "confirmed")}
            pending={subscribers.filter((row) => row.status === "unconfirmed")}
            campaigns={campaigns}
            fromDomain={config.fromDomain}
            message={message(context.request)}
          />,
        );
      },
      async update(context) {
        const id = parseId(context.params.id);
        if (!id) return new Response("Bad Request", { status: 400 });
        if (!canAccessList(db, user, id)) return forbidden();
        if (
          !db
            .select({ id: schema.lists.id })
            .from(schema.lists)
            .where(eq(schema.lists.id, id))
            .get()
        )
          return new Response("Not Found", { status: 404 });
        const values = await readListForm(context.request, config.fromDomain);
        if (!values) return new Response("Invalid list", { status: 400 });
        db.update(schema.lists)
          .set(values)
          .where(eq(schema.lists.id, id))
          .run();
        logEvent(db, {
          type: "admin.list_edited",
          detail: `${values.name} (${values.slug})`,
          userId: user.id,
        });
        return redirect(`/admin/lists/${id}?status=saved`);
      },
      destroy(context) {
        if (!isAdmin) return forbidden();
        const id = parseId(context.params.id);
        if (!id) return new Response("Bad Request", { status: 400 });
        const list = db
          .select()
          .from(schema.lists)
          .where(eq(schema.lists.id, id))
          .get();
        if (!list) return new Response("Not Found", { status: 404 });
        db.transaction((tx) => {
          const campaigns = tx
            .select({ id: schema.campaigns.id })
            .from(schema.campaigns)
            .where(
              and(
                eq(schema.campaigns.audienceType, "list"),
                eq(schema.campaigns.audienceId, id),
              ),
            )
            .all();
          const campaignIds = campaigns.map((campaign) => campaign.id);
          tx.delete(schema.subscriberLists)
            .where(eq(schema.subscriberLists.listId, id))
            .run();
          if (campaignIds.length) {
            tx.update(schema.messages)
              .set({ campaignId: null })
              .where(inArray(schema.messages.campaignId, campaignIds))
              .run();
            tx.update(schema.events)
              .set({ campaignId: null })
              .where(inArray(schema.events.campaignId, campaignIds))
              .run();
            tx.delete(schema.campaignSends)
              .where(inArray(schema.campaignSends.campaignId, campaignIds))
              .run();
            tx.delete(schema.campaigns)
              .where(inArray(schema.campaigns.id, campaignIds))
              .run();
          }
          tx.delete(schema.userLists)
            .where(eq(schema.userLists.listId, id))
            .run();
          tx.delete(schema.lists).where(eq(schema.lists.id, id)).run();
        });
        logEvent(db, {
          type: "admin.list_deleted",
          detail: list.name,
          userId: user.id,
        });
        return redirect("/admin/lists?status=deleted");
      },
    },
  });
}
