import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { css, type Handle } from "remix/component";
import { createController } from "remix/router";

import { getAccessibleListIds } from "../src/auth.ts";
import { schema, type Db } from "../src/db/index.ts";
import { AdminDocument, type Viewer } from "./admin.tsx";
import { routes } from "./routes.ts";

type User = Pick<
  typeof schema.users.$inferSelect,
  "id" | "role" | "name" | "email"
>;
type Event = Pick<
  typeof schema.events.$inferSelect,
  | "id"
  | "type"
  | "detail"
  | "subscriberId"
  | "campaignId"
  | "messageId"
  | "createdAt"
> & { userName: string | null };
type FilterOption = { id: number; label: string };
type Filters = { group: string; subscriber: string; campaign: string };

const PAGE_SIZE = 50;
const groups = [
  { value: "subscriber", label: "Subscribers" },
  { value: "campaign", label: "Campaigns" },
  { value: "inbound", label: "Inbound" },
  { value: "admin", label: "Admin" },
];

const headingRow = css({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "20px",
});
const heading = css({ margin: 0, fontSize: "24px", fontWeight: 650 });
const muted = css({ color: "#6b7280", fontSize: "13px" });
const filterForm = css({
  display: "flex",
  alignItems: "end",
  flexWrap: "wrap",
  gap: "12px",
  marginBottom: "24px",
});
const filterField = css({
  display: "grid",
  gap: "5px",
  color: "#4b5563",
  fontSize: "13px",
});
const select = css({
  padding: "7px 10px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  backgroundColor: "#fff",
  font: "inherit",
});
const button = css({
  padding: "7px 12px",
  border: "1px solid #1f2937",
  borderRadius: "6px",
  backgroundColor: "#1f2937",
  color: "#fff",
  font: "inherit",
  cursor: "pointer",
});
const link = css({ color: "#1d4ed8", textDecoration: "none" });
const eventRow = css({
  display: "grid",
  gridTemplateColumns: "45px 115px 140px minmax(0, 1fr) auto",
  gap: "12px",
  alignItems: "baseline",
  padding: "10px 0",
  borderBottom: "1px solid #e5e7eb",
  fontSize: "14px",
});
const eventGroup = css({
  color: "#4b5563",
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
});
const pagination = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  marginTop: "24px",
});

function eventLink(event: Event) {
  if (event.subscriberId) return `/admin/subscribers/${event.subscriberId}`;
  if (event.campaignId) return `/admin/campaigns/${event.campaignId}`;
  if (event.messageId) return `/admin/inbound/${event.messageId}`;
  return null;
}

function pageHref(filters: Filters, page: number) {
  const query = new URLSearchParams({ page: String(page) });
  if (filters.group) query.set("group", filters.group);
  if (filters.subscriber) query.set("subscriber", filters.subscriber);
  if (filters.campaign) query.set("campaign", filters.campaign);
  return `/admin/activity?${query}`;
}

function ActivityPage(
  handle: Handle<{
    viewer: Viewer;
    events: Event[];
    filters: Filters;
    subscribers: FilterOption[];
    campaigns: FilterOption[];
    page: number;
    hasMore: boolean;
  }>,
) {
  return () => {
    const { viewer, events, filters, subscribers, campaigns, page, hasMore } =
      handle.props;
    return (
      <AdminDocument
        title="Activity"
        activeHref="/admin/activity"
        viewer={viewer}
      >
        <div mix={headingRow}>
          <h1 mix={heading}>Activity</h1>
          <span mix={muted}>Page {page}</span>
        </div>
        <form mix={filterForm} method="get" action="/admin/activity">
          <label mix={filterField}>
            Type
            <select mix={select} name="group" defaultValue={filters.group}>
              <option value="">All</option>
              {groups.map((group) => (
                <option value={group.value}>{group.label}</option>
              ))}
            </select>
          </label>
          {subscribers.length ? (
            <label mix={filterField}>
              Subscriber
              <select
                mix={select}
                name="subscriber"
                defaultValue={filters.subscriber}
              >
                <option value="">All</option>
                {subscribers.map((subscriber) => (
                  <option value={String(subscriber.id)}>
                    {subscriber.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {campaigns.length ? (
            <label mix={filterField}>
              Campaign
              <select
                mix={select}
                name="campaign"
                defaultValue={filters.campaign}
              >
                <option value="">All</option>
                {campaigns.map((campaign) => (
                  <option value={String(campaign.id)}>
                    {campaign.label.slice(0, 40)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button mix={button} type="submit">
            Filter
          </button>
          {filters.group || filters.subscriber || filters.campaign ? (
            <a mix={link} href="/admin/activity">
              Clear
            </a>
          ) : null}
        </form>
        <div>
          {events.map((event) => {
            const target = eventLink(event);
            return (
              <div mix={eventRow}>
                <span mix={eventGroup}>{event.type.split(".", 1)[0]}</span>
                <span>{event.userName ?? "System"}</span>
                <span>
                  {event.type
                    .replace(/^(admin|subscriber|campaign|inbound)\./, "")
                    .replaceAll("_", " ")}
                </span>
                <span>
                  {target ? (
                    <a mix={link} href={target}>
                      {event.detail}
                    </a>
                  ) : (
                    event.detail
                  )}
                </span>
                <time mix={muted} dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleString("en-US")}
                </time>
              </div>
            );
          })}
          {events.length === 0 ? (
            <p mix={muted}>No events match the current filters.</p>
          ) : null}
        </div>
        {page > 1 || hasMore ? (
          <nav mix={pagination} aria-label="Activity pages">
            {page > 1 ? (
              <a mix={link} href={pageHref(filters, page - 1)}>
                ← Previous
              </a>
            ) : (
              <span />
            )}
            <span mix={muted}>
              Showing {PAGE_SIZE * (page - 1) + 1}–
              {PAGE_SIZE * (page - 1) + events.length}
            </span>
            {hasMore ? (
              <a mix={link} href={pageHref(filters, page + 1)}>
                Next →
              </a>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </AdminDocument>
    );
  };
}

function positiveId(value: string) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function createAdminActivityController(db: Db, user: User) {
  const viewer: Viewer = {
    name: user.name ?? user.email,
    isAdmin: user.role !== "member",
  };
  return createController(routes.admin.activity, {
    actions: {
      index(context) {
        const query = new URL(context.request.url).searchParams;
        const page = Math.max(1, positiveId(query.get("page") ?? "1") ?? 1);
        const filters: Filters = {
          group: query.get("group") ?? "",
          subscriber: query.get("subscriber") ?? "",
          campaign: query.get("campaign") ?? "",
        };
        const conditions = [];
        if (
          filters.group &&
          groups.some((group) => group.value === filters.group)
        )
          conditions.push(like(schema.events.type, `${filters.group}.%`));
        if (positiveId(filters.subscriber))
          conditions.push(
            eq(schema.events.subscriberId, positiveId(filters.subscriber)!),
          );
        if (positiveId(filters.campaign))
          conditions.push(
            eq(schema.events.campaignId, positiveId(filters.campaign)!),
          );

        const access = getAccessibleListIds(db, user);
        if (access !== "all") {
          const campaignIds = access.length
            ? db
                .select({ id: schema.campaigns.id })
                .from(schema.campaigns)
                .where(
                  and(
                    eq(schema.campaigns.audienceType, "list"),
                    inArray(schema.campaigns.audienceId, access),
                  ),
                )
                .all()
                .map((row) => row.id)
            : [];
          const subscriberIds = access.length
            ? db
                .selectDistinct({ id: schema.subscribers.id })
                .from(schema.subscribers)
                .innerJoin(
                  schema.subscriberLists,
                  eq(
                    schema.subscribers.id,
                    schema.subscriberLists.subscriberId,
                  ),
                )
                .where(inArray(schema.subscriberLists.listId, access))
                .all()
                .map((row) => row.id)
            : [];
          conditions.push(
            or(
              campaignIds.length
                ? inArray(schema.events.campaignId, campaignIds)
                : undefined,
              subscriberIds.length
                ? inArray(schema.events.subscriberId, subscriberIds)
                : undefined,
            ) ?? sql`0`,
          );
        }
        const events = db
          .select({
            id: schema.events.id,
            type: schema.events.type,
            detail: schema.events.detail,
            subscriberId: schema.events.subscriberId,
            campaignId: schema.events.campaignId,
            messageId: schema.events.messageId,
            createdAt: schema.events.createdAt,
            userName: schema.users.name,
          })
          .from(schema.events)
          .leftJoin(schema.users, eq(schema.events.userId, schema.users.id))
          .where(and(...conditions))
          .orderBy(desc(schema.events.createdAt))
          .limit(PAGE_SIZE + 1)
          .offset((page - 1) * PAGE_SIZE)
          .all();
        const subscribers =
          access === "all"
            ? db
                .select({
                  id: schema.subscribers.id,
                  label: schema.subscribers.email,
                })
                .from(schema.subscribers)
                .orderBy(schema.subscribers.email)
                .all()
            : [];
        const campaigns =
          access === "all"
            ? db
                .select({
                  id: schema.campaigns.id,
                  label: schema.campaigns.subject,
                })
                .from(schema.campaigns)
                .orderBy(desc(schema.campaigns.createdAt))
                .limit(50)
                .all()
            : [];
        return context.render(
          <ActivityPage
            viewer={viewer}
            events={events.slice(0, PAGE_SIZE)}
            filters={filters}
            subscribers={subscribers}
            campaigns={campaigns}
            page={page}
            hasMore={events.length > PAGE_SIZE}
          />,
        );
      },
    },
  });
}
