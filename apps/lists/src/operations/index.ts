import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import type { Db } from "../db";
import { schema } from "../db";
import type { Config } from "../config";
import { sendCampaign } from "../services/sender";
import {
  createSubscriber,
  getConfirmedSubscribers,
} from "../services/subscriber";
import { sendSubscriptionConfirmations } from "../services/subscription-confirmation";
import { renderCampaignMessage } from "../services/campaign-renderer";
import { logEvent } from "../services/events";
import {
  assertListAccess,
  assertScope,
  canAccessSubscriber,
  AccessDeniedError,
  type Principal,
} from "../services/access";
import type {
  CreateCampaignDraftInput,
  CreateSubscriberInput,
  UpdateCampaignDraftInput,
} from "./contracts";
import { renderTemplate } from "../services/email-templates";

export class NotFoundError extends Error {
  status = 404;
}
export class InvalidOperationError extends Error {
  status = 400;
}

export type OperationContext = { db: Db; config: Config; principal: Principal };

function visibleListIds(ctx: OperationContext): number[] | null {
  return ctx.principal.listIds === "all" ? null : [...ctx.principal.listIds];
}

export function listLists(ctx: OperationContext) {
  assertScope(ctx.principal, "lists:read");
  const ids = visibleListIds(ctx);
  if (ids?.length === 0) return [];
  return ids
    ? ctx.db
        .select()
        .from(schema.lists)
        .where(inArray(schema.lists.id, ids))
        .all()
    : ctx.db.select().from(schema.lists).all();
}

export function getListStats(ctx: OperationContext, listId: number) {
  assertScope(ctx.principal, "lists:read");
  assertListAccess(ctx.principal, listId);
  const list = ctx.db
    .select({ id: schema.lists.id })
    .from(schema.lists)
    .where(eq(schema.lists.id, listId))
    .get();
  if (!list) throw new NotFoundError("List not found");
  const counts = ctx.db
    .select({
      status: schema.subscriberLists.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.subscriberLists)
    .innerJoin(
      schema.subscribers,
      eq(schema.subscribers.id, schema.subscriberLists.subscriberId),
    )
    .where(
      and(
        eq(schema.subscriberLists.listId, listId),
        eq(schema.subscribers.status, "active"),
      ),
    )
    .groupBy(schema.subscriberLists.status)
    .all();
  const byStatus = Object.fromEntries(
    counts.map((row) => [row.status, row.count]),
  );
  return {
    listId,
    confirmed: byStatus.confirmed ?? 0,
    unconfirmed: byStatus.unconfirmed ?? 0,
    unsubscribed: byStatus.unsubscribed ?? 0,
  };
}

export function listSubscribers(
  ctx: OperationContext,
  input: {
    limit?: number;
    offset?: number;
    status?: string;
    listId?: number;
    membershipStatus?: string;
    search?: string;
  } = {},
) {
  assertScope(ctx.principal, "subscribers:read");
  if (input.membershipStatus && !input.listId)
    throw new InvalidOperationError(
      "listId is required when filtering by membership status",
    );
  if (input.listId) assertListAccess(ctx.principal, input.listId);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const ids = visibleListIds(ctx);
  if (ids?.length === 0) return [];

  const conditions = [];
  if (input.status === "active" || input.status === "blocklisted") {
    conditions.push(eq(schema.subscribers.status, input.status));
  }
  if (input.listId)
    conditions.push(eq(schema.subscriberLists.listId, input.listId));
  else if (ids) conditions.push(inArray(schema.subscriberLists.listId, ids));
  if (
    input.membershipStatus === "confirmed" ||
    input.membershipStatus === "unconfirmed" ||
    input.membershipStatus === "unsubscribed"
  )
    conditions.push(eq(schema.subscriberLists.status, input.membershipStatus));
  if (input.search)
    conditions.push(like(schema.subscribers.email, `%${input.search}%`));

  const rows = ctx.db
    .select({
      id: schema.subscribers.id,
      email: schema.subscribers.email,
      firstName: schema.subscribers.firstName,
      lastName: schema.subscribers.lastName,
      status: schema.subscribers.status,
      createdAt: schema.subscribers.createdAt,
      membershipStatus: schema.subscriberLists.status,
    })
    .from(schema.subscribers)
    .leftJoin(
      schema.subscriberLists,
      eq(schema.subscriberLists.subscriberId, schema.subscribers.id),
    )
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(schema.subscribers.id)
    .orderBy(desc(schema.subscribers.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
  return rows.map((row) => ({
    ...row,
    membershipStatus: input.listId ? row.membershipStatus : null,
  }));
}

export function getSubscriber(ctx: OperationContext, id: number) {
  assertScope(ctx.principal, "subscribers:read");
  if (!canAccessSubscriber(ctx.db, ctx.principal, id))
    throw new AccessDeniedError("Subscriber access denied");
  const subscriber = ctx.db
    .select({
      id: schema.subscribers.id,
      email: schema.subscribers.email,
      firstName: schema.subscribers.firstName,
      lastName: schema.subscribers.lastName,
      status: schema.subscribers.status,
      createdAt: schema.subscribers.createdAt,
    })
    .from(schema.subscribers)
    .where(eq(schema.subscribers.id, id))
    .get();
  if (!subscriber) throw new NotFoundError("Subscriber not found");
  const memberships = ctx.db
    .select({
      listId: schema.lists.id,
      listSlug: schema.lists.slug,
      listName: schema.lists.name,
      status: schema.subscriberLists.status,
      subscribedAt: schema.subscriberLists.subscribedAt,
    })
    .from(schema.subscriberLists)
    .innerJoin(schema.lists, eq(schema.lists.id, schema.subscriberLists.listId))
    .where(eq(schema.subscriberLists.subscriberId, id))
    .all()
    .filter(
      (row) =>
        ctx.principal.listIds === "all" ||
        ctx.principal.listIds.has(row.listId),
    );
  return { ...subscriber, membershipStatus: null, memberships };
}

export function unsubscribeSubscriber(
  ctx: OperationContext,
  id: number,
  listId: number,
  confirm: boolean,
) {
  assertScope(ctx.principal, "subscribers:write");
  if (!confirm)
    throw new InvalidOperationError("Unsubscribing requires confirm=true");
  assertListAccess(ctx.principal, listId);
  const membership = ctx.db
    .select({ id: schema.subscriberLists.subscriberId })
    .from(schema.subscriberLists)
    .where(
      and(
        eq(schema.subscriberLists.subscriberId, id),
        eq(schema.subscriberLists.listId, listId),
      ),
    )
    .get();
  if (!membership) throw new NotFoundError("Subscriber membership not found");
  ctx.db
    .update(schema.subscriberLists)
    .set({ status: "unsubscribed" })
    .where(
      and(
        eq(schema.subscriberLists.subscriberId, id),
        eq(schema.subscriberLists.listId, listId),
      ),
    )
    .run();
  logEvent(ctx.db, {
    type: "subscriber.unsubscribed",
    detail: `Subscriber ${id} unsubscribed from list ${listId} by user ${ctx.principal.userId}`,
    subscriberId: id,
    userId: ctx.principal.userId,
  });
  return { id, listId, status: "unsubscribed" as const };
}

export async function createSubscriberOperation(
  ctx: OperationContext,
  input: CreateSubscriberInput,
) {
  assertScope(ctx.principal, "subscribers:write");
  const listSlugs = [...new Set(input.lists)];
  const selectedLists: (typeof schema.lists.$inferSelect)[] = [];
  for (const slug of listSlugs) {
    const list = ctx.db
      .select()
      .from(schema.lists)
      .where(eq(schema.lists.slug, slug))
      .get();
    if (!list) throw new InvalidOperationError(`Unknown list slug: ${slug}`);
    assertListAccess(ctx.principal, list.id);
    selectedLists.push(list);
  }
  const existing = ctx.db
    .select()
    .from(schema.subscribers)
    .where(eq(schema.subscribers.email, input.email.toLowerCase().trim()))
    .get();
  if (input.sendConfirmation && existing?.status === "blocklisted") {
    throw new InvalidOperationError(
      "Cannot send confirmation to a blocklisted subscriber",
    );
  }
  const subscriber = createSubscriber(
    ctx.db,
    input.email,
    input.firstName ?? input.name ?? null,
    input.lastName ?? null,
    listSlugs,
  );
  if (input.sendConfirmation) {
    const memberships = ctx.db
      .select()
      .from(schema.subscriberLists)
      .where(eq(schema.subscriberLists.subscriberId, subscriber.id))
      .all();
    const unconfirmedIds = new Set(
      memberships
        .filter((row) => row.status === "unconfirmed")
        .map((row) => row.listId),
    );
    await sendSubscriptionConfirmations(
      ctx.config,
      subscriber,
      selectedLists.filter((list) => unconfirmedIds.has(list.id)),
    );
  }
  return { id: subscriber.id, email: subscriber.email };
}

export function deleteSubscriber(
  ctx: OperationContext,
  id: number,
  confirm: boolean,
) {
  assertScope(ctx.principal, "subscribers:write");
  if (!confirm)
    throw new InvalidOperationError("Deletion requires confirm=true");
  if (!canAccessSubscriber(ctx.db, ctx.principal, id))
    throw new AccessDeniedError("Subscriber access denied");
  const subscriber = ctx.db
    .select({ id: schema.subscribers.id, email: schema.subscribers.email })
    .from(schema.subscribers)
    .where(eq(schema.subscribers.id, id))
    .get();
  if (!subscriber) throw new NotFoundError("Subscriber not found");
  ctx.db.transaction((tx) => {
    tx.delete(schema.subscriberTags)
      .where(eq(schema.subscriberTags.subscriberId, id))
      .run();
    tx.delete(schema.subscriberLists)
      .where(eq(schema.subscriberLists.subscriberId, id))
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
      type: "api.subscriber_deleted",
      detail: subscriber.email,
      meta: { subscriberId: id },
      userId: ctx.principal.userId,
    });
  });
  return { id: subscriber.id, deleted: true as const };
}

export function listCampaigns(
  ctx: OperationContext,
  input: { limit?: number; offset?: number } = {},
) {
  assertScope(ctx.principal, "campaigns:read");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const ids = visibleListIds(ctx);
  if (ids?.length === 0) return [];
  return ctx.db
    .select()
    .from(schema.campaigns)
    .where(
      ids
        ? and(
            eq(schema.campaigns.audienceType, "list"),
            inArray(schema.campaigns.audienceId, ids),
          )
        : undefined,
    )
    .orderBy(desc(schema.campaigns.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
}

export function getCampaign(ctx: OperationContext, id: number) {
  assertScope(ctx.principal, "campaigns:read");
  const campaign = ctx.db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, id))
    .get();
  if (!campaign) throw new NotFoundError("Campaign not found");
  if (campaign.audienceType === "list" && campaign.audienceId)
    assertListAccess(ctx.principal, campaign.audienceId);
  if (ctx.principal.listIds !== "all" && campaign.audienceType !== "list")
    throw new AccessDeniedError("Campaign access denied");
  const counts = ctx.db
    .select({
      status: schema.campaignSends.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.campaignSends)
    .where(eq(schema.campaignSends.campaignId, id))
    .groupBy(schema.campaignSends.status)
    .all();
  return {
    ...campaign,
    deliveryCounts: Object.fromEntries(
      counts.map((row) => [row.status, row.count]),
    ),
  };
}

export function listCampaignSends(
  ctx: OperationContext,
  input: { id: number; limit?: number; offset?: number },
) {
  getCampaign(ctx, input.id);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  return ctx.db
    .select({
      id: schema.campaignSends.id,
      subscriberId: schema.campaignSends.subscriberId,
      email: schema.subscribers.email,
      status: schema.campaignSends.status,
      attemptCount: schema.campaignSends.attemptCount,
      acceptedAt: schema.campaignSends.acceptedAt,
      deliveredAt: schema.campaignSends.deliveredAt,
      lastError: schema.campaignSends.lastError,
    })
    .from(schema.campaignSends)
    .leftJoin(
      schema.subscribers,
      eq(schema.subscribers.id, schema.campaignSends.subscriberId),
    )
    .where(eq(schema.campaignSends.campaignId, input.id))
    .orderBy(schema.campaignSends.id)
    .limit(limit)
    .offset(offset)
    .all();
}

export async function previewCampaign(ctx: OperationContext, id: number) {
  const campaign = getCampaign(ctx, id);
  const list =
    campaign.audienceType === "list" && campaign.audienceId
      ? ctx.db
          .select()
          .from(schema.lists)
          .where(eq(schema.lists.id, campaign.audienceId))
          .get()
      : null;
  return renderCampaignMessage(ctx.db, {
    campaign,
    subscriber: {
      email: "reader@example.com",
      firstName: "Jane",
      lastName: "Doe",
    },
    list: { name: list?.name ?? "Newsletter" },
    links: { unsubscribe: "#unsubscribe", preferences: "#preferences" },
  });
}

async function validateCampaignDraft(
  ctx: OperationContext,
  input: CreateCampaignDraftInput,
) {
  if (
    !input.subject.trim() ||
    !input.bodyMarkdown.trim() ||
    !input.fromAddress.trim()
  ) {
    throw new InvalidOperationError(
      "subject, bodyMarkdown, and fromAddress are required",
    );
  }
  if (input.audienceType === "list") {
    if (!input.audienceId)
      throw new InvalidOperationError(
        "audienceId is required for list campaigns",
      );
    assertListAccess(ctx.principal, input.audienceId);
  } else if (ctx.principal.listIds !== "all") {
    throw new AccessDeniedError("Only admins can use non-list audiences");
  }
  const template = ctx.db
    .select()
    .from(schema.emailTemplates)
    .where(
      and(
        eq(schema.emailTemplates.slug, input.templateSlug ?? "newsletter"),
        eq(schema.emailTemplates.status, "active"),
      ),
    )
    .get();
  if (!template)
    throw new InvalidOperationError("Active email template not found");
  await renderTemplate(template, {
    subscriber: {
      email: "reader@example.com",
      firstName: "Jane",
      lastName: "Doe",
    },
    campaign: { subject: input.subject },
    list: { name: "Preview" },
    links: { unsubscribe: "#unsubscribe", preferences: "#preferences" },
    sectionSources: { ...input.templateSections, content: input.bodyMarkdown },
  });
  return {
    subject: input.subject.trim(),
    bodyMarkdown: input.bodyMarkdown,
    fromAddress: input.fromAddress.trim(),
    fromName: input.fromName?.trim() || null,
    audienceType: input.audienceType,
    audienceId: input.audienceId ?? null,
    audienceData:
      input.audienceType === "subscribers"
        ? JSON.stringify(input.audienceData)
        : null,
    templateSlug: template.slug,
    templateSections: JSON.stringify({
      ...input.templateSections,
      content: input.bodyMarkdown,
    }),
  };
}

export async function createCampaignDraft(
  ctx: OperationContext,
  input: CreateCampaignDraftInput,
) {
  assertScope(ctx.principal, "campaigns:write");
  const values = await validateCampaignDraft(ctx, input);
  return ctx.db
    .insert(schema.campaigns)
    .values({ ...values, status: "draft" })
    .returning()
    .get();
}

export async function updateCampaignDraft(
  ctx: OperationContext,
  input: UpdateCampaignDraftInput,
) {
  assertScope(ctx.principal, "campaigns:write");
  const existing = ctx.db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, input.id))
    .get();
  if (!existing) throw new NotFoundError("Campaign not found");
  if (existing.audienceType === "list" && existing.audienceId)
    assertListAccess(ctx.principal, existing.audienceId);
  if (ctx.principal.listIds !== "all" && existing.audienceType !== "list")
    throw new AccessDeniedError("Campaign access denied");
  if (existing.status !== "draft")
    throw new InvalidOperationError("Only draft campaigns can be updated");
  const values = await validateCampaignDraft(ctx, input.campaign);
  const updated = ctx.db
    .update(schema.campaigns)
    .set(values)
    .where(
      and(
        eq(schema.campaigns.id, input.id),
        eq(schema.campaigns.status, "draft"),
      ),
    )
    .returning()
    .get();
  if (!updated)
    throw new InvalidOperationError("Only draft campaigns can be updated");
  return updated;
}

export async function sendCampaignOperation(
  ctx: OperationContext,
  id: number,
  confirm: boolean,
) {
  assertScope(ctx.principal, "campaigns:send");
  const campaign = getCampaign(
    {
      ...ctx,
      principal: {
        ...ctx.principal,
        scopes: new Set([...ctx.principal.scopes, "campaigns:read"]),
      },
    },
    id,
  );
  if (!confirm)
    throw new InvalidOperationError("Sending requires confirm=true");
  if (
    campaign.status !== "draft" &&
    campaign.status !== "scheduled" &&
    campaign.status !== "failed"
  ) {
    throw new InvalidOperationError(
      `Campaign cannot be sent from status ${campaign.status}`,
    );
  }
  await sendCampaign(ctx.db, ctx.config, id);
  return getCampaign(
    {
      ...ctx,
      principal: {
        ...ctx.principal,
        scopes: new Set([...ctx.principal.scopes, "campaigns:read"]),
      },
    },
    id,
  );
}

export async function sendCampaignTestOperation(
  ctx: OperationContext,
  id: number,
  subscriberIds: number[],
  confirm: boolean,
) {
  assertScope(ctx.principal, "campaigns:send");
  if (!confirm)
    throw new InvalidOperationError("Test sending requires confirm=true");
  const campaign = getCampaign(
    {
      ...ctx,
      principal: {
        ...ctx.principal,
        scopes: new Set([...ctx.principal.scopes, "campaigns:read"]),
      },
    },
    id,
  );
  if (
    campaign.status !== "draft" ||
    campaign.audienceType !== "list" ||
    !campaign.audienceId
  )
    throw new InvalidOperationError(
      "Only list campaign drafts can be test sent",
    );
  const ids = [...new Set(subscriberIds)];
  if (ids.length === 0 || ids.length > 20)
    throw new InvalidOperationError("Select 1 to 20 test subscribers");
  const eligible = new Set(
    getConfirmedSubscribers(ctx.db, campaign.audienceId).map(
      (subscriber) => subscriber.id,
    ),
  );
  if (ids.some((subscriberId) => !eligible.has(subscriberId)))
    throw new InvalidOperationError(
      "All test recipients must be active, confirmed members of the campaign list",
    );
  const testCampaign = ctx.db
    .insert(schema.campaigns)
    .values({
      subject: `Test: ${campaign.subject}`,
      bodyMarkdown: campaign.bodyMarkdown,
      fromAddress: campaign.fromAddress,
      fromName: campaign.fromName,
      audienceType: "list",
      audienceId: campaign.audienceId,
      audienceData: JSON.stringify({ testSubscriberIds: ids }),
      status: "draft",
      templateSlug: campaign.templateSlug,
      templateSections: campaign.templateSections,
    })
    .returning()
    .get();
  await sendCampaign(ctx.db, ctx.config, testCampaign.id);
  return getCampaign(
    {
      ...ctx,
      principal: {
        ...ctx.principal,
        scopes: new Set([...ctx.principal.scopes, "campaigns:read"]),
      },
    },
    testCampaign.id,
  );
}

export function getDeliverabilitySummary(ctx: OperationContext) {
  assertScope(ctx.principal, "deliverability:read");
  const ids = visibleListIds(ctx);
  if (ids?.length === 0) return { sends: {}, events: {} };
  const campaignFilter = ids
    ? and(
        eq(schema.campaigns.audienceType, "list"),
        inArray(schema.campaigns.audienceId, ids),
      )
    : undefined;
  const rows = ctx.db
    .select({
      status: schema.campaignSends.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.campaignSends)
    .innerJoin(
      schema.campaigns,
      eq(schema.campaigns.id, schema.campaignSends.campaignId),
    )
    .where(campaignFilter)
    .groupBy(schema.campaignSends.status)
    .all();
  const recentEvents = ctx.db
    .select({
      eventType: schema.deliveryEvents.eventType,
      count: sql<number>`count(*)`,
    })
    .from(schema.deliveryEvents)
    .innerJoin(
      schema.campaignSends,
      eq(schema.campaignSends.sesMessageId, schema.deliveryEvents.sesMessageId),
    )
    .innerJoin(
      schema.campaigns,
      eq(schema.campaigns.id, schema.campaignSends.campaignId),
    )
    .where(campaignFilter)
    .groupBy(schema.deliveryEvents.eventType)
    .all();
  return {
    sends: Object.fromEntries(rows.map((row) => [row.status, row.count])),
    events: Object.fromEntries(
      recentEvents.map((row) => [row.eventType, row.count]),
    ),
  };
}

export function getDmarcSummary(ctx: OperationContext) {
  assertScope(ctx.principal, "dmarc:read");
  const allowedDomains = new Set(
    listLists({
      ...ctx,
      principal: {
        ...ctx.principal,
        scopes: new Set([...ctx.principal.scopes, "lists:read"]),
      },
    }).map((list) => list.fromDomain),
  );
  const reports = ctx.db
    .select({
      domain: schema.dmarcReports.domain,
      reports: sql<number>`count(*)`,
      messages: sql<number>`coalesce(sum(${schema.dmarcReports.messageCount}), 0)`,
      latest: sql<string | null>`max(${schema.dmarcReports.dateEnd})`,
    })
    .from(schema.dmarcReports)
    .groupBy(schema.dmarcReports.domain)
    .all()
    .filter((row) => allowedDomains.has(row.domain));
  return reports;
}
