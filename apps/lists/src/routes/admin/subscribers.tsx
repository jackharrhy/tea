/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import type { App } from "../../http";
import { eq, desc, and, inArray, like, sql } from "drizzle-orm";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { Db } from "../../db";
import { schema } from "../../db";
import type { Config } from "../../config";
import { getAccessibleListIds, getAccessibleLists } from "../../auth";
import { createSubscriber, confirmSubscriber } from "../../services/subscriber";
import { renderConfirmation } from "../../../emails/render";
import { buildConfirmUrl } from "../../compliance";
import { logEvent } from "../../services/events";
import {
  AdminLayout,
  displayName,
  fmtDate,
  fmtDateTime,
  setFlash,
  getFlash,
  type User,
} from "./layout";
import {
  Button,
  LinkButton,
  Input,
  Select,
  Label,
  FormGroup,
  Table,
  Th,
  Td,
  Card,
  PageHeader,
  Pagination,
} from "./ui";
import { sendEmail } from "../../services/mailer";
import { z } from "zod";

const PAGE_SIZE = 50;
type SubscriberListRow = Pick<
  typeof schema.subscribers.$inferSelect,
  | "id"
  | "email"
  | "firstName"
  | "lastName"
  | "status"
  | "unsubscribeToken"
  | "createdAt"
> & { membershipCount: number };
const SubscriberIdentitySchema = z.object({
  email: z
    .email()
    .trim()
    .transform((email) => email.toLowerCase()),
  firstName: z
    .string()
    .trim()
    .default("")
    .transform((name) => name || null),
  lastName: z
    .string()
    .trim()
    .default("")
    .transform((name) => name || null),
});
const CreateSubscriberFormSchema = SubscriberIdentitySchema.extend({
  skip_confirm: z.literal("1").optional().transform(Boolean),
  lists: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((lists) =>
      lists ? (Array.isArray(lists) ? lists : [lists]) : [],
    ),
});
const EditSubscriberFormSchema = SubscriberIdentitySchema.extend({
  status: z.enum(["active", "blocklisted"]).default("active"),
});

function SubscriberIdentityFields({
  subscriber,
}: {
  subscriber?: Pick<
    typeof schema.subscribers.$inferSelect,
    "email" | "firstName" | "lastName"
  >;
}) {
  return (
    <>
      <FormGroup>
        <Label for="email">Email</Label>
        <Input
          type="email"
          id="email"
          name="email"
          required
          value={subscriber?.email ?? ""}
        />
      </FormGroup>
      <FormGroup>
        <Label for="firstName">
          First name{subscriber ? "" : " (optional)"}
        </Label>
        <Input
          type="text"
          id="firstName"
          name="firstName"
          value={subscriber?.firstName ?? ""}
        />
      </FormGroup>
      <FormGroup>
        <Label for="lastName">Last name{subscriber ? "" : " (optional)"}</Label>
        <Input
          type="text"
          id="lastName"
          name="lastName"
          value={subscriber?.lastName ?? ""}
        />
      </FormGroup>
    </>
  );
}

function confirmedCondition(positive: boolean) {
  return positive
    ? sql`EXISTS (SELECT 1 FROM subscriber_lists sl WHERE sl.subscriber_id = ${schema.subscribers.id} AND sl.status = 'confirmed')`
    : sql`NOT EXISTS (SELECT 1 FROM subscriber_lists sl WHERE sl.subscriber_id = ${schema.subscribers.id} AND sl.status = 'confirmed')`;
}

export function mountSubscriberRoutes(app: App, db: Db, config: Config) {
  app.get("/subscribers", (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    const listAccess = getAccessibleListIds(db, user);

    // Query params
    const page = Math.max(1, parseInt(c.query.page ?? "1", 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;
    const filterSearch = c.query.search ?? "";
    const filterStatus = c.query.status ?? "";
    const filterConfirmed = c.query.confirmed ?? "";
    const filterMembership = c.query.membership ?? "";

    // Build where conditions
    const conditions: any[] = [];
    if (filterSearch) {
      const pattern = `%${filterSearch}%`;
      conditions.push(
        sql`(${like(schema.subscribers.email, pattern)} OR ${like(schema.subscribers.firstName, pattern)} OR ${like(schema.subscribers.lastName, pattern)})`,
      );
    }
    if (filterStatus === "active" || filterStatus === "blocklisted") {
      conditions.push(eq(schema.subscribers.status, filterStatus));
    }

    const orphanedCondition = sql`NOT EXISTS (SELECT 1 FROM subscriber_lists sl WHERE sl.subscriber_id = ${schema.subscribers.id})`;
    if (listAccess === "all" && filterMembership === "orphaned") {
      conditions.push(orphanedCondition);
    }

    // Base select shape for selectDistinct path
    const baseSelect = {
      id: schema.subscribers.id,
      email: schema.subscribers.email,
      firstName: schema.subscribers.firstName,
      lastName: schema.subscribers.lastName,
      status: schema.subscribers.status,
      unsubscribeToken: schema.subscribers.unsubscribeToken,
      createdAt: schema.subscribers.createdAt,
      membershipCount: sql<number>`(SELECT count(*) FROM subscriber_lists sl WHERE sl.subscriber_id = ${schema.subscribers.id})`,
    };

    if (filterConfirmed === "confirmed") {
      conditions.push(confirmedCondition(true));
    } else if (filterConfirmed === "unconfirmed") {
      conditions.push(confirmedCondition(false));
    }

    let subscribers: SubscriberListRow[];
    let total = 0;
    const orphanedTotal =
      listAccess === "all"
        ? (db
            .select({ count: sql<number>`count(*)` })
            .from(schema.subscribers)
            .where(orphanedCondition)
            .get()?.count ?? 0)
        : 0;

    if (listAccess === "all") {
      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // Count
      const countRow = whereClause
        ? db
            .select({ count: sql<number>`count(*)` })
            .from(schema.subscribers)
            .where(whereClause)
            .get()
        : db
            .select({ count: sql<number>`count(*)` })
            .from(schema.subscribers)
            .get();
      total = countRow?.count ?? 0;

      // Page
      const q = db
        .select(baseSelect)
        .from(schema.subscribers)
        .orderBy(desc(schema.subscribers.createdAt));
      subscribers = (whereClause ? q.where(whereClause) : q)
        .limit(PAGE_SIZE)
        .offset(offset)
        .all();
    } else if (listAccess.length === 0) {
      subscribers = [];
      total = 0;
    } else {
      const accessCondition = inArray(
        schema.subscriberLists.listId,
        listAccess,
      );
      const allConditions =
        conditions.length > 0
          ? and(accessCondition, ...conditions)
          : accessCondition;

      // Count (selectDistinct workaround: use subquery count)
      const countRow = db
        .selectDistinct({ id: schema.subscribers.id })
        .from(schema.subscribers)
        .innerJoin(
          schema.subscriberLists,
          eq(schema.subscriberLists.subscriberId, schema.subscribers.id),
        )
        .where(allConditions)
        .all();
      total = countRow.length;

      subscribers = db
        .selectDistinct(baseSelect)
        .from(schema.subscribers)
        .innerJoin(
          schema.subscriberLists,
          eq(schema.subscriberLists.subscriberId, schema.subscribers.id),
        )
        .where(allConditions)
        .orderBy(desc(schema.subscribers.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset)
        .all();
    }

    const hasFilters = !!(
      filterSearch ||
      filterStatus ||
      filterConfirmed ||
      filterMembership
    );
    const start = total === 0 ? 0 : offset + 1;
    const end = Math.min(offset + PAGE_SIZE, total);

    function buildUrl(params: Record<string, string | number>) {
      const q = new URLSearchParams({
        ...(filterSearch ? { search: filterSearch } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(filterConfirmed ? { confirmed: filterConfirmed } : {}),
        ...(filterMembership ? { membership: filterMembership } : {}),
        page: String(page),
        ...params,
      });
      return `/admin/subscribers?${q.toString()}`;
    }

    return c.html(
      <AdminLayout title="Subscribers" user={user} flash={flash}>
        <PageHeader title="Subscribers">
          <div class="flex items-center gap-2">
            {orphanedTotal > 0 && (
              <LinkButton
                href="/admin/subscribers?membership=orphaned"
                variant="secondary"
              >
                {orphanedTotal} orphaned
              </LinkButton>
            )}
            <LinkButton href="/admin/subscribers/new">
              Add subscriber
            </LinkButton>
          </div>
        </PageHeader>

        {/* Filters */}
        <form
          method="get"
          action="/admin/subscribers"
          hx-get="/admin/subscribers"
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
              placeholder="Email or name…"
              class="w-48"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">
              Status
            </label>
            <Select name="status" size="sm">
              <option value="" selected={!filterStatus}>
                All
              </option>
              <option value="active" selected={filterStatus === "active"}>
                Active
              </option>
              <option
                value="blocklisted"
                selected={filterStatus === "blocklisted"}
              >
                Blocklisted
              </option>
            </Select>
          </div>
          {listAccess === "all" && (
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1">
                Membership
              </label>
              <Select name="membership" size="sm">
                <option value="" selected={!filterMembership}>
                  All
                </option>
                <option
                  value="orphaned"
                  selected={filterMembership === "orphaned"}
                >
                  Orphaned
                </option>
              </Select>
            </div>
          )}
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">
              Confirmed
            </label>
            <Select name="confirmed" size="sm">
              <option value="" selected={!filterConfirmed}>
                All
              </option>
              <option
                value="confirmed"
                selected={filterConfirmed === "confirmed"}
              >
                Confirmed
              </option>
              <option
                value="unconfirmed"
                selected={filterConfirmed === "unconfirmed"}
              >
                Unconfirmed
              </option>
            </Select>
          </div>
          <input type="hidden" name="page" value="1" />
          <Button type="submit" size="filter">
            Filter
          </Button>
          {hasFilters && (
            <a
              href="/admin/subscribers"
              class="text-sm text-gray-500 hover:text-gray-700 no-underline"
            >
              Clear
            </a>
          )}
        </form>

        <Table>
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>Lists</Th>
              <Th>Created</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {subscribers.map((sub) => (
              <tr>
                <Td>
                  <a
                    href={`/admin/subscribers/${sub.id}`}
                    class="text-blue-600 hover:text-blue-800"
                  >
                    {sub.email}
                  </a>
                </Td>
                <Td>{displayName(sub)}</Td>
                <Td>{sub.status}</Td>
                <Td>
                  {sub.membershipCount === 0 ? (
                    <span class="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Orphaned
                    </span>
                  ) : (
                    sub.membershipCount
                  )}
                </Td>
                <Td>{fmtDate(sub.createdAt)}</Td>
                <Td>
                  <form
                    method="post"
                    action={`/admin/subscribers/${sub.id}/delete`}
                    class="m-0"
                    onsubmit={`return confirm('Delete ${sub.email}?')`}
                  >
                    <button
                      type="submit"
                      class="bg-transparent border-none text-red-600 cursor-pointer text-sm p-0"
                    >
                      delete
                    </button>
                  </form>
                </Td>
              </tr>
            ))}
            {subscribers.length === 0 && (
              <tr>
                <Td class="text-gray-400">
                  <span>No subscribers match the current filters.</span>
                </Td>
                <Td></Td>
                <Td></Td>
                <Td></Td>
                <Td></Td>
                <Td></Td>
              </tr>
            )}
          </tbody>
        </Table>

        {/* Pagination */}
        {(total > PAGE_SIZE || page > 1) && (
          <Pagination
            previousHref={page > 1 ? buildUrl({ page: page - 1 }) : undefined}
            nextHref={end < total ? buildUrl({ page: page + 1 }) : undefined}
            summary={
              <>
                Showing {start}–{end} of {total}
              </>
            }
          />
        )}
      </AdminLayout>,
    );
  });

  app.get("/subscribers/new", (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    const allLists = getAccessibleLists(db, user);

    return c.html(
      <AdminLayout title="Add Subscriber" user={user} flash={flash}>
        <PageHeader title="Add subscriber" />
        <Card>
          <form method="post" action="/admin/subscribers/new">
            <SubscriberIdentityFields />
            <FormGroup>
              <label class="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input type="checkbox" name="skip_confirm" value="1" />
                Pre-confirm list subscriptions (skip double opt-in)
              </label>
            </FormGroup>
            {allLists.length > 0 && (
              <FormGroup>
                <p class="text-sm font-medium text-gray-700 mb-2">Lists</p>
                {allLists.map((list) => (
                  <label class="flex items-center gap-2 text-sm text-gray-800 mb-1">
                    <input type="checkbox" name="lists" value={list.slug} />
                    {list.name}
                  </label>
                ))}
              </FormGroup>
            )}
            <Button type="submit">Add Subscriber</Button>
          </form>
        </Card>
      </AdminLayout>,
    );
  });

  app.post(
    "/subscribers/new",
    async (c) => {
      const user = c.user as User;
      const {
        email,
        firstName,
        lastName,
        skip_confirm: skipConfirm,
        lists: listSlugs,
      } = c.body;

      const subscriber = createSubscriber(
        db,
        email,
        firstName,
        lastName,
        listSlugs,
      );

      if (skipConfirm) {
        confirmSubscriber(db, subscriber.unsubscribeToken);
      }

      logEvent(db, {
        type: "admin.subscriber_added",
        detail: email,
        subscriberId: subscriber.id,
        userId: user.id,
      });

      setFlash(c, "Subscriber added.");
      return c.redirect("/admin/subscribers");
    },
    { body: CreateSubscriberFormSchema },
  );

  app.get("/subscribers/:id", (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    const id = Number(c.params.id);
    const sub = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.id, id))
      .get();
    if (!sub) return c.notFound();

    const listAccess = getAccessibleListIds(db, user);
    const allLists = getAccessibleLists(db, user);

    const subLists = db
      .select()
      .from(schema.subscriberLists)
      .where(eq(schema.subscriberLists.subscriberId, id))
      .all();
    const subListMap = new Map(subLists.map((sl) => [sl.listId, sl.status]));

    // For members, verify this subscriber is on one of their accessible lists
    if (listAccess !== "all") {
      const onAccessibleList = subLists.some((sl) =>
        (listAccess as number[]).includes(sl.listId),
      );
      if (!onAccessibleList) return c.text("Forbidden", 403);
    }

    const subEvents = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.subscriberId, id))
      .orderBy(desc(schema.events.createdAt))
      .limit(50)
      .all();

    const subSends = db
      .select({
        campaignId: schema.campaignSends.campaignId,
        status: schema.campaignSends.status,
        sentAt: schema.campaignSends.sentAt,
        subject: schema.campaigns.subject,
      })
      .from(schema.campaignSends)
      .leftJoin(
        schema.campaigns,
        eq(schema.campaignSends.campaignId, schema.campaigns.id),
      )
      .where(eq(schema.campaignSends.subscriberId, id))
      .orderBy(desc(schema.campaignSends.sentAt))
      .all();

    // Tags
    const subTagRows = db
      .select({ id: schema.tags.id, name: schema.tags.name })
      .from(schema.subscriberTags)
      .innerJoin(schema.tags, eq(schema.subscriberTags.tagId, schema.tags.id))
      .where(eq(schema.subscriberTags.subscriberId, id))
      .all();
    const subTagIds = new Set(subTagRows.map((t) => t.id));
    const allTags = db.select().from(schema.tags).all();
    const availableTags = allTags.filter((t) => !subTagIds.has(t.id));

    return c.html(
      <AdminLayout title={sub.email} user={user} flash={flash}>
        <PageHeader title={sub.email} />

        <form method="post" action={`/admin/subscribers/${id}/edit`}>
          <SubscriberIdentityFields subscriber={sub} />
          <FormGroup>
            <Label for="status">Status</Label>
            <Select id="status" name="status">
              <option value="active" selected={sub.status === "active"}>
                active
              </option>
              <option
                value="blocklisted"
                selected={sub.status === "blocklisted"}
              >
                blocklisted
              </option>
            </Select>
          </FormGroup>

          <Button type="submit">Save changes</Button>
        </form>

        <h2 class="text-xl font-semibold mt-6 mb-3">List subscriptions</h2>

        {(() => {
          const subscribedLists = allLists.filter((l) => subListMap.has(l.id));
          const unsubscribedLists = allLists.filter(
            (l) => !subListMap.has(l.id),
          );

          return (
            <>
              {subscribedLists.length > 0 ? (
                <div class="space-y-3 mb-6">
                  {subscribedLists.map((list) => {
                    const listStatus = subListMap.get(list.id)!;
                    return (
                      <div class="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
                        <div>
                          <span class="font-medium text-sm">{list.name}</span>
                          <span class="text-xs text-gray-400 ml-2">
                            {list.fromDomain}
                          </span>
                        </div>
                        <div class="flex items-center gap-2">
                          <form
                            method="post"
                            action={`/admin/subscribers/${sub.id}/list/${list.id}/status`}
                            class="flex items-center gap-2 m-0"
                          >
                            <select
                              name="listStatus"
                              class="px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option
                                value="unconfirmed"
                                selected={listStatus === "unconfirmed"}
                              >
                                unconfirmed
                              </option>
                              <option
                                value="confirmed"
                                selected={listStatus === "confirmed"}
                              >
                                confirmed
                              </option>
                              <option
                                value="unsubscribed"
                                selected={listStatus === "unsubscribed"}
                              >
                                unsubscribed
                              </option>
                            </select>
                            <button
                              type="submit"
                              class="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200 cursor-pointer border border-gray-300"
                            >
                              Set
                            </button>
                          </form>
                          <form
                            method="post"
                            action={`/admin/subscribers/${sub.id}/list/${list.id}/remove`}
                            class="m-0"
                            onsubmit={`return confirm('Remove from ${list.name}?')`}
                          >
                            <button
                              type="submit"
                              class="px-2 py-1 bg-red-50 text-red-600 text-xs rounded hover:bg-red-100 cursor-pointer border border-red-200"
                            >
                              Remove
                            </button>
                          </form>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p class="text-gray-400 text-sm mb-4">
                  Not subscribed to any lists.
                </p>
              )}

              {(() => {
                // Group unconfirmed subscriberLists by domain for per-domain send-confirm
                const unconfirmedByDomain = new Map<
                  string,
                  { domain: string; count: number }
                >();
                for (const list of subscribedLists) {
                  if (subListMap.get(list.id) === "unconfirmed") {
                    const entry = unconfirmedByDomain.get(list.fromDomain);
                    if (entry) {
                      entry.count++;
                    } else {
                      unconfirmedByDomain.set(list.fromDomain, {
                        domain: list.fromDomain,
                        count: 1,
                      });
                    }
                  }
                }
                const domains = [...unconfirmedByDomain.values()];
                if (domains.length === 0) return null;
                return (
                  <div class="mb-6 space-y-2">
                    <p class="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                      Send confirmation email
                    </p>
                    {domains.map(({ domain, count }) => (
                      <div class="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-2">
                        <span class="text-sm text-gray-700">
                          {domain}: {count} unconfirmed{" "}
                          {count === 1 ? "list" : "lists"}
                        </span>
                        <form
                          method="post"
                          action={`/admin/subscribers/${sub.id}/send-confirm`}
                          class="m-0"
                        >
                          <input type="hidden" name="domain" value={domain} />
                          <button
                            type="submit"
                            class="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 cursor-pointer border-none"
                          >
                            Send confirmation
                          </button>
                        </form>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {unsubscribedLists.length > 0 && (
                <div class="mb-6">
                  <p class="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                    Add to list
                  </p>
                  <div class="space-y-2">
                    {unsubscribedLists.map((list) => (
                      <div class="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2">
                        <div>
                          <span class="text-sm text-gray-600">{list.name}</span>
                          <span class="text-xs text-gray-400 ml-2">
                            {list.fromDomain}
                          </span>
                        </div>
                        <div class="flex items-center gap-2">
                          <form
                            method="post"
                            action={`/admin/subscribers/${sub.id}/list/${list.id}/add`}
                            class="m-0"
                          >
                            <input
                              type="hidden"
                              name="listStatus"
                              value="unconfirmed"
                            />
                            <button
                              type="submit"
                              class="px-2 py-1 bg-white text-gray-700 text-xs rounded hover:bg-gray-100 cursor-pointer border border-gray-300"
                            >
                              Add (unconfirmed)
                            </button>
                          </form>
                          <form
                            method="post"
                            action={`/admin/subscribers/${sub.id}/list/${list.id}/add`}
                            class="m-0"
                          >
                            <input
                              type="hidden"
                              name="listStatus"
                              value="confirmed"
                            />
                            <button
                              type="submit"
                              class="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 cursor-pointer border-none"
                            >
                              Add (confirmed)
                            </button>
                          </form>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}

        <h2 class="text-xl font-semibold mt-6 mb-3">Tags</h2>
        <div class="mb-4">
          <div class="flex flex-wrap gap-2 mb-3">
            {subTagRows.map((tag) => (
              <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                {tag.name}
                <form
                  method="post"
                  action={`/admin/subscribers/${id}/tags/${tag.id}/remove`}
                  class="m-0 inline"
                >
                  <button
                    type="submit"
                    class="bg-transparent border-none cursor-pointer text-gray-400 hover:text-red-600 p-0 text-xs leading-none"
                  >
                    &times;
                  </button>
                </form>
              </span>
            ))}
            {subTagRows.length === 0 && (
              <span class="text-gray-400 text-sm">No tags</span>
            )}
          </div>
          {availableTags.length > 0 && (
            <form
              method="post"
              action={`/admin/subscribers/${id}/tags/add`}
              class="flex items-center gap-2"
            >
              <select
                name="tagId"
                class="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {availableTags.map((tag) => (
                  <option value={String(tag.id)}>{tag.name}</option>
                ))}
              </select>
              <button
                type="submit"
                class="inline-block px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 cursor-pointer border-none no-underline"
              >
                Add
              </button>
            </form>
          )}
        </div>

        <dl class="mt-6">
          <dt class="font-semibold text-xs uppercase text-gray-500 first:mt-0">
            Created
          </dt>
          <dd class="mt-1 ml-0">{fmtDateTime(sub.createdAt)}</dd>
          <dt class="font-semibold text-xs uppercase text-gray-500 mt-3">
            Unsubscribe token
          </dt>
          <dd class="mt-1 ml-0 text-xs font-mono">{sub.unsubscribeToken}</dd>
        </dl>

        {subSends.length > 0 && (
          <>
            <h2 class="text-xl font-semibold mt-6 mb-3">
              Campaigns received ({subSends.length})
            </h2>
            <Table>
              <thead>
                <tr>
                  <Th>Campaign</Th>
                  <Th>Status</Th>
                  <Th>Sent</Th>
                </tr>
              </thead>
              <tbody>
                {subSends.map((s) => (
                  <tr>
                    <Td>
                      <a
                        href={`/admin/campaigns/${s.campaignId}`}
                        class="text-blue-600 hover:text-blue-800"
                      >
                        {s.subject ?? `Campaign ${s.campaignId}`}
                      </a>
                    </Td>
                    <Td>{s.status}</Td>
                    <Td>{fmtDateTime(s.sentAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}

        {subEvents.length > 0 && (
          <>
            <h2 class="text-xl font-semibold mt-6 mb-3">Activity</h2>
            <div class="flex flex-col gap-0.5">
              {subEvents.map((e) => (
                <div class="flex gap-3 py-1.5 border-b border-gray-100 text-sm">
                  <span class="font-medium min-w-[12rem]">{e.type}</span>
                  <span class="text-gray-600 flex-1">{e.detail}</span>
                  <span class="text-gray-400 whitespace-nowrap">
                    {fmtDateTime(e.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <hr class="my-8" />
        <form
          method="post"
          action={`/admin/subscribers/${id}/delete`}
          onsubmit="return confirm('Delete this subscriber and all their list subscriptions? This cannot be undone.')"
        >
          <Button type="submit" variant="danger">
            Delete Subscriber
          </Button>
        </form>
      </AdminLayout>,
    );
  });

  app.post(
    "/subscribers/:id/edit",
    async (c) => {
      const user = c.user as User;
      const id = Number(c.params.id);
      const { email, firstName, lastName, status } = c.body;

      db.update(schema.subscribers)
        .set({ email, firstName, lastName, status })
        .where(eq(schema.subscribers.id, id))
        .run();

      logEvent(db, {
        type: "admin.subscriber_edited",
        detail: email,
        subscriberId: id,
        userId: user.id,
      });

      setFlash(c, "Subscriber updated.");
      return c.redirect(`/admin/subscribers/${id}`);
    },
    { body: EditSubscriberFormSchema },
  );

  app.post("/subscribers/:id/delete", (c) => {
    const user = c.user as User;
    const id = Number(c.params.id);
    const sub = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.id, id))
      .get();

    db.transaction((tx) => {
      tx.delete(schema.subscriberLists)
        .where(eq(schema.subscriberLists.subscriberId, id))
        .run();
      tx.delete(schema.subscriberTags)
        .where(eq(schema.subscriberTags.subscriberId, id))
        .run();
      tx.delete(schema.campaignSends)
        .where(eq(schema.campaignSends.subscriberId, id))
        .run();
      tx.update(schema.events)
        .set({ subscriberId: null })
        .where(eq(schema.events.subscriberId, id))
        .run();
      tx.delete(schema.subscribers).where(eq(schema.subscribers.id, id)).run();
      logEvent(tx, {
        type: "admin.subscriber_deleted",
        detail: sub?.email ?? `id=${id}`,
        meta: { subscriberId: id },
        userId: user.id,
      });
    });
    setFlash(c, "Subscriber deleted.");
    return c.redirect("/admin/subscribers");
  });

  app.post("/subscribers/:id/send-confirm", async (c) => {
    const user = c.user as User;
    const id = Number(c.params.id);
    const sub = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.id, id))
      .get();
    if (!sub) return c.notFound();

    const body = c.body as Record<string, any>;
    const domain = body["domain"] ? String(body["domain"]).trim() : null;

    // find unconfirmed lists for this subscriber, filtered by domain if provided
    const unconfirmedSubLists = db
      .select({
        listId: schema.subscriberLists.listId,
        fromDomain: schema.lists.fromDomain,
      })
      .from(schema.subscriberLists)
      .innerJoin(
        schema.lists,
        eq(schema.subscriberLists.listId, schema.lists.id),
      )
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, id),
          eq(schema.subscriberLists.status, "unconfirmed"),
          ...(domain ? [eq(schema.lists.fromDomain, domain)] : []),
        ),
      )
      .all();

    // nothing to confirm
    if (unconfirmedSubLists.length === 0) {
      return c.redirect(`/admin/subscribers/${id}`);
    }

    const sendingDomain =
      domain ?? unconfirmedSubLists[0]!.fromDomain ?? config.fromDomain;

    const listNames = unconfirmedSubLists
      .map(
        (sl) =>
          db
            .select()
            .from(schema.lists)
            .where(eq(schema.lists.id, sl.listId))
            .get()?.name,
      )
      .filter(Boolean) as string[];

    const confirmUrl = buildConfirmUrl(
      config.baseUrl,
      sub.unsubscribeToken,
      sendingDomain,
    );
    const { html } = await renderConfirmation({ confirmUrl, listNames });

    await sendEmail(
      config,
      new SendEmailCommand({
        FromEmailAddress: `noreply@${sendingDomain}`,
        Destination: { ToAddresses: [sub.email] },
        Content: {
          Simple: {
            Subject: { Data: "Confirm your subscription" },
            Body: { Html: { Data: html } },
          },
        },
        ConfigurationSetName: config.sesConfigSet || undefined,
        EmailTags: [
          { Name: "subscriber_id", Value: String(sub.id) },
          { Name: "message_kind", Value: "confirmation" },
        ],
      }).input,
    );

    logEvent(db, {
      type: "admin.confirmation_sent",
      detail: `Confirmation email sent to ${sub.email} for ${sendingDomain}`,
      subscriberId: id,
      userId: user.id,
    });

    setFlash(c, "Confirmation email sent.");
    return c.redirect(`/admin/subscribers/${id}`);
  });

  app.post("/subscribers/:id/list/:listId/add", async (c) => {
    const subId = Number(c.params.id);
    const listId = Number(c.params.listId);
    const body = c.body as Record<string, any>;
    const rawListStatus = String(body["listStatus"] ?? "unconfirmed");
    const listStatus: "unconfirmed" | "confirmed" | "unsubscribed" =
      rawListStatus === "confirmed" || rawListStatus === "unsubscribed"
        ? rawListStatus
        : "unconfirmed";
    db.insert(schema.subscriberLists)
      .values({ subscriberId: subId, listId, status: listStatus })
      .onConflictDoNothing()
      .run();
    setFlash(c, "Added to list.");
    return c.redirect(`/admin/subscribers/${subId}`);
  });

  app.post("/subscribers/:id/list/:listId/status", async (c) => {
    const subId = Number(c.params.id);
    const listId = Number(c.params.listId);
    const body = c.body as Record<string, any>;
    const rawListStatus = String(body["listStatus"] ?? "unconfirmed");
    const listStatus: "unconfirmed" | "confirmed" | "unsubscribed" =
      rawListStatus === "confirmed" || rawListStatus === "unsubscribed"
        ? rawListStatus
        : "unconfirmed";
    db.update(schema.subscriberLists)
      .set({ status: listStatus })
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subId),
          eq(schema.subscriberLists.listId, listId),
        ),
      )
      .run();
    setFlash(c, "Status updated.");
    return c.redirect(`/admin/subscribers/${subId}`);
  });

  app.post("/subscribers/:id/list/:listId/remove", (c) => {
    const subId = Number(c.params.id);
    const listId = Number(c.params.listId);
    db.delete(schema.subscriberLists)
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subId),
          eq(schema.subscriberLists.listId, listId),
        ),
      )
      .run();
    setFlash(c, "Removed from list.");
    return c.redirect(`/admin/subscribers/${subId}`);
  });

  app.post("/subscribers/:id/tags/add", async (c) => {
    const id = Number(c.params.id);
    const body = c.body as Record<string, any>;
    const tagId = Number(body["tagId"]);

    if (tagId) {
      db.insert(schema.subscriberTags)
        .values({ subscriberId: id, tagId })
        .onConflictDoNothing()
        .run();
    }

    return c.redirect(`/admin/subscribers/${id}`);
  });

  app.post("/subscribers/:id/tags/:tagId/remove", (c) => {
    const id = Number(c.params.id);
    const tagId = Number(c.params.tagId);

    db.delete(schema.subscriberTags)
      .where(
        and(
          eq(schema.subscriberTags.subscriberId, id),
          eq(schema.subscriberTags.tagId, tagId),
        ),
      )
      .run();

    return c.redirect(`/admin/subscribers/${id}`);
  });
}
