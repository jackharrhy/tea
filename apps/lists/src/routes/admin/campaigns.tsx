/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import type { App } from "../../http";
import { z } from "zod";
import { eq, desc, and, inArray, like, sql } from "drizzle-orm";
import type { Db } from "../../db";
import { schema } from "../../db";
import type { Config } from "../../config";
import { getAccessibleListIds, getAccessibleLists } from "../../auth";
import { sendCampaign } from "../../services/sender";
import { buildUnsubscribeUrl, buildPreferencesUrl } from "../../compliance";
import { logEvent } from "../../services/events";
import { getConfirmedSubscribers } from "../../services/subscriber";
import { processImage, deleteCampaignS3Images } from "../../services/images";
import {
  CampaignEditorAccessError,
  CampaignEditorFormSchema,
  CampaignEditorReferenceError,
  createCampaignFromEditor,
  updateCampaignFromEditor,
} from "../../services/campaign-editor";
import {
  AdminLayout,
  fmtDate,
  fmtDateTime,
  CampaignBadge,
  describeAudience,
  setFlash,
  getFlash,
  type User,
} from "./layout";
import {
  Button,
  LinkButton,
  Input,
  Select,
  Table,
  Th,
  Td,
  PageHeader,
  Pagination,
} from "./ui";
import { CampaignEditorPage } from "./campaign-form";
import type { CampaignTemplateChoice } from "./campaign-form";
import {
  TemplateValidationError,
  type TemplateSection,
} from "../../services/email-templates";
import { renderCampaignMessage } from "../../services/campaign-renderer";
import { testSubscriberIds } from "../../services/campaign-audience";

const CAMPAIGNS_PAGE_SIZE = 25;
const CampaignListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  status: z
    .enum(["", "draft", "scheduled", "sending", "sent", "failed"])
    .default(""),
  search: z.string().default(""),
});
const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:; font-src data:";

function previewSrcdoc(html: string) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`)
    : `${meta}${html}`;
}

function textPreview(text: string) {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<pre style="white-space:pre-wrap;font-family:system-ui;padding:24px">${escaped}</pre>`;
}

function activeTemplateChoices(db: Db): CampaignTemplateChoice[] {
  return db
    .select()
    .from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.status, "active"))
    .all()
    .map((template) => ({
      slug: template.slug,
      name: template.name,
      sections: JSON.parse(template.sections) as TemplateSection[],
    }));
}

export function mountCampaignRoutes(app: App, db: Db, config: Config) {
  // ---- Preview endpoints (raw HTML, no AdminLayout) -----------------------

  app.get("/campaigns/:id/preview", async (c) => {
    c.set.headers["Content-Security-Policy"] = PREVIEW_CSP;
    const id = Number(c.params.id);
    const campaign = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .get();
    if (!campaign) return c.notFound();

    let listName = "Newsletter";
    if (campaign.audienceType === "list" && campaign.audienceId) {
      const list = db
        .select()
        .from(schema.lists)
        .where(eq(schema.lists.id, campaign.audienceId))
        .get();
      if (list) {
        listName = list.name;
      }
    }

    let unsubscribeUrl = "#unsubscribe";
    let preferencesUrl = "#preferences";
    let subData: {
      firstName?: string | null;
      lastName?: string | null;
      email: string;
    } = {
      firstName: "Jane",
      lastName: "Doe",
      email: "subscriber@example.com",
    };

    const subscriberId = c.query.subscriberId;
    if (subscriberId) {
      const sub = db
        .select()
        .from(schema.subscribers)
        .where(eq(schema.subscribers.id, Number(subscriberId)))
        .get();
      if (sub) {
        unsubscribeUrl = buildUnsubscribeUrl(
          config.baseUrl,
          sub.unsubscribeToken,
          (campaign.audienceType === "list"
            ? campaign.audienceId
            : undefined) ?? undefined,
        );
        preferencesUrl = buildPreferencesUrl(
          config.baseUrl,
          sub.unsubscribeToken,
        );
        subData = {
          firstName: sub.firstName,
          lastName: sub.lastName,
          email: sub.email,
        };
      }
    }

    const rendered = await renderCampaignMessage(db, {
      campaign,
      subscriber: subData,
      list: { name: listName },
      links: { unsubscribe: unsubscribeUrl, preferences: preferencesUrl },
    });
    return c.html(rendered.html ?? textPreview(rendered.text));
  });

  const CampaignPreviewSchema = z.object({
    bodyMarkdown: z.string().default(""),
    subject: z.string().default("Preview"),
    listName: z.string().default("Newsletter"),
    templateSlug: z.string().min(1).default("newsletter"),
    templateSections: z.record(z.string(), z.string()).default({}),
  });

  app.post(
    "/campaigns/preview",
    async (c) => {
      c.set.headers["Content-Security-Policy"] = PREVIEW_CSP;
      const {
        bodyMarkdown,
        subject,
        listName,
        templateSlug,
        templateSections,
      } = c.body;
      const rendered = await renderCampaignMessage(db, {
        campaign: {
          subject: subject || "Preview",
          bodyMarkdown,
          templateSlug,
          templateSections: JSON.stringify(templateSections),
        },
        subscriber: {
          firstName: "Jane",
          lastName: "Doe",
          email: "subscriber@example.com",
        },
        list: { name: listName || "Newsletter" },
        links: { unsubscribe: "#unsubscribe", preferences: "#preferences" },
      });
      return c.html(previewSrcdoc(rendered.html ?? textPreview(rendered.text)));
    },
    { body: CampaignPreviewSchema },
  );

  app.post(
    "/campaigns/upload-image",
    async (c) => {
      const file = c.body.image;

      const originalSize = file.size;
      const buf = await file.arrayBuffer();

      try {
        const processed = await processImage(buf);
        return c.json({
          dataUri: processed.dataUri,
          sizeBytes: processed.sizeBytes,
          originalSizeBytes: originalSize,
          width: processed.width,
          height: processed.height,
          mimeType: processed.mimeType,
        });
      } catch {
        return c.json({ error: "Failed to process image" }, 400);
      }
    },
    { body: z.object({ image: z.file() }) },
  );

  // Campaigns
  app.get(
    "/campaigns",
    (c) => {
      const user = c.user as User;
      const flash = getFlash(c);
      const listAccess = getAccessibleListIds(db, user);

      // Query params
      const page = c.query.page;
      const offset = (page - 1) * CAMPAIGNS_PAGE_SIZE;
      const filterStatus = c.query.status;
      const filterSearch = c.query.search;

      // Build where conditions
      const filterConditions = [];
      if (filterStatus) {
        filterConditions.push(eq(schema.campaigns.status, filterStatus));
      }
      if (filterSearch) {
        filterConditions.push(
          like(schema.campaigns.subject, `%${filterSearch}%`),
        );
      }

      let campaigns: (typeof schema.campaigns.$inferSelect)[];
      let total = 0;

      if (listAccess === "all") {
        const conditions =
          filterConditions.length > 0 ? and(...filterConditions) : undefined;
        const countRow = db
          .select({ count: sql<number>`count(*)` })
          .from(schema.campaigns)
          .where(conditions)
          .get()!;
        total = countRow.count;

        const q = db
          .select()
          .from(schema.campaigns)
          .orderBy(desc(schema.campaigns.createdAt));
        campaigns = (conditions ? q.where(conditions) : q)
          .limit(CAMPAIGNS_PAGE_SIZE)
          .offset(offset)
          .all();
      } else if (listAccess.length === 0) {
        campaigns = [];
        total = 0;
      } else {
        const accessCond = and(
          eq(schema.campaigns.audienceType, "list"),
          inArray(schema.campaigns.audienceId, listAccess),
        );
        const conditions =
          filterConditions.length > 0
            ? and(accessCond, ...filterConditions)
            : accessCond;
        const countRow = db
          .select({ count: sql<number>`count(*)` })
          .from(schema.campaigns)
          .where(conditions)
          .get()!;
        total = countRow.count;

        campaigns = db
          .select()
          .from(schema.campaigns)
          .where(conditions)
          .orderBy(desc(schema.campaigns.createdAt))
          .limit(CAMPAIGNS_PAGE_SIZE)
          .offset(offset)
          .all();
      }

      const totalPages = Math.max(1, Math.ceil(total / CAMPAIGNS_PAGE_SIZE));

      // Build lookup maps for list and tag names
      const allLists = db.select().from(schema.lists).all();
      const listNameMap = new Map(allLists.map((l) => [l.id, l.name]));
      const allTags = db.select().from(schema.tags).all();
      const tagNameMap = new Map(allTags.map((t) => [t.id, t.name]));

      function buildUrl(params: Record<string, string | number>) {
        const q = new URLSearchParams({
          ...(filterStatus ? { status: filterStatus } : {}),
          ...(filterSearch ? { search: filterSearch } : {}),
          page: String(page),
          ...params,
        });
        return `/admin/campaigns?${q.toString()}`;
      }

      const CAMPAIGN_STATUSES = [
        { value: "", label: "All" },
        { value: "draft", label: "Draft" },
        { value: "scheduled", label: "Scheduled" },
        { value: "sending", label: "Sending" },
        { value: "sent", label: "Sent" },
        { value: "failed", label: "Failed" },
      ];

      return c.html(
        <AdminLayout title="Campaigns" user={user} flash={flash}>
          <PageHeader title="Campaigns">
            <LinkButton href="/admin/campaigns/new">New Campaign</LinkButton>
          </PageHeader>

          {/* Filters */}
          <form
            method="get"
            action="/admin/campaigns"
            hx-get="/admin/campaigns"
            hx-trigger="keyup changed delay:350ms from:input[name='search'], change from:select"
            class="filter-bar flex items-end gap-3 mb-6 flex-wrap"
          >
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1">
                Status
              </label>
              <Select name="status" size="sm">
                {CAMPAIGN_STATUSES.map((s) => (
                  <option value={s.value} selected={filterStatus === s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
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
                placeholder="Subject…"
                class="w-48"
              />
            </div>
            <input type="hidden" name="page" value="1" />
            <Button type="submit" size="filter">
              Filter
            </Button>
            {(filterStatus || filterSearch) && (
              <a
                href="/admin/campaigns"
                class="text-sm text-gray-500 hover:text-gray-700 no-underline"
              >
                Clear
              </a>
            )}
          </form>

          <Table>
            <thead>
              <tr>
                <Th>Subject</Th>
                <Th>Audience</Th>
                <Th>From</Th>
                <Th>Status</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((cam) => (
                <tr>
                  <Td>
                    <a
                      href={`/admin/campaigns/${cam.id}`}
                      class="text-blue-600 hover:text-blue-800"
                    >
                      {cam.subject}
                    </a>
                  </Td>
                  <Td>{describeAudience(cam, listNameMap, tagNameMap)}</Td>
                  <Td>{cam.fromAddress}</Td>
                  <Td>
                    <CampaignBadge status={cam.status} />
                    {cam.status === "scheduled" && cam.scheduledAt && (
                      <span class="ml-2 text-xs text-gray-500">
                        {fmtDateTime(cam.scheduledAt)}
                      </span>
                    )}
                  </Td>
                  <Td>{fmtDate(cam.createdAt)}</Td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr>
                  <Td class="text-gray-400" colspan={5}>
                    No campaigns found.
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>

          {/* Pagination */}
          {(page > 1 || total > CAMPAIGNS_PAGE_SIZE) && (
            <Pagination
              previousHref={page > 1 ? buildUrl({ page: page - 1 }) : undefined}
              nextHref={
                page < totalPages ? buildUrl({ page: page + 1 }) : undefined
              }
              summary={
                <>
                  {total} campaign{total !== 1 ? "s" : ""} &middot; page {page}{" "}
                  of {totalPages}
                </>
              }
            />
          )}
        </AdminLayout>,
      );
    },
    { query: CampaignListQuerySchema },
  );

  app.get("/campaigns/new", (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    const allLists = getAccessibleLists(db, user);

    const allTags = db.select().from(schema.tags).all();
    const allSubscribers = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.status, "active"))
      .all();

    return c.html(
      <CampaignEditorPage
        user={user}
        flash={flash}
        config={config}
        lists={allLists}
        tags={allTags}
        subscribers={allSubscribers}
        templates={activeTemplateChoices(db)}
      />,
    );
  });

  app.post(
    "/campaigns/new",
    async (c) => {
      const user = c.user as User;
      let result;
      try {
        result = await createCampaignFromEditor(db, config, user, c.body);
      } catch (error) {
        if (error instanceof CampaignEditorAccessError)
          return c.text("Forbidden", 403);
        if (error instanceof CampaignEditorReferenceError)
          return c.text(error.message, 400);
        if (error instanceof TemplateValidationError)
          return c.text(error.message, 400);
        throw error;
      }

      logEvent(db, {
        type: "admin.campaign_created",
        detail: result.subject,
        campaignId: result.id,
        userId: user.id,
      });

      setFlash(c, "Campaign created.");
      return c.redirect(`/admin/campaigns/${result.id}`);
    },
    { body: CampaignEditorFormSchema },
  );

  app.get("/campaigns/:id", async (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    const id = Number(c.params.id);
    const campaign = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .get();
    if (!campaign) return c.notFound();

    // Check list access (non-list audienceType = accessible to admins/owners)
    const listAccess = getAccessibleListIds(db, user);
    if (
      campaign.audienceType === "list" &&
      campaign.audienceId !== null &&
      listAccess !== "all" &&
      !listAccess.includes(campaign.audienceId)
    ) {
      return c.text("Forbidden", 403);
    }

    // Build lookup maps for audience description
    const detailLists = db.select().from(schema.lists).all();
    const detailListMap = new Map(detailLists.map((l) => [l.id, l.name]));
    const detailTags = db.select().from(schema.tags).all();
    const detailTagMap = new Map(detailTags.map((t) => [t.id, t.name]));
    const audienceDesc = describeAudience(
      campaign,
      detailListMap,
      detailTagMap,
    );
    const selectedTestIds = testSubscriberIds(
      campaign.audienceType,
      campaign.audienceData,
    );

    const sends = db
      .select({ send: schema.campaignSends, email: schema.subscribers.email })
      .from(schema.campaignSends)
      .leftJoin(
        schema.subscribers,
        eq(schema.subscribers.id, schema.campaignSends.subscriberId),
      )
      .where(eq(schema.campaignSends.campaignId, id))
      .all();

    const inboundReplies = db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.campaignId, id),
          eq(schema.messages.direction, "inbound"),
        ),
      )
      .orderBy(desc(schema.messages.createdAt))
      .all();

    // Get subscribers for preview picker based on audience
    let previewSubscribers: { id: number; email: string }[];
    if (campaign.audienceType === "list" && campaign.audienceId) {
      previewSubscribers = getConfirmedSubscribers(db, campaign.audienceId);
      if (selectedTestIds) {
        const selected = new Set(selectedTestIds);
        previewSubscribers = previewSubscribers.filter((subscriber) =>
          selected.has(subscriber.id),
        );
      }
    } else if (campaign.audienceType === "tag" && campaign.audienceId) {
      previewSubscribers = db
        .selectDistinct({
          id: schema.subscribers.id,
          email: schema.subscribers.email,
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
            eq(schema.subscriberTags.tagId, campaign.audienceId),
            eq(schema.subscribers.status, "active"),
            eq(schema.subscriberLists.status, "confirmed"),
          ),
        )
        .all();
    } else if (
      campaign.audienceType === "subscribers" &&
      campaign.audienceData
    ) {
      const ids = JSON.parse(campaign.audienceData) as number[];
      previewSubscribers = ids.length
        ? db
            .selectDistinct({
              id: schema.subscribers.id,
              email: schema.subscribers.email,
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
            .all()
        : [];
    } else {
      // "all" type or unknown — get all active confirmed
      previewSubscribers = db
        .selectDistinct({
          id: schema.subscribers.id,
          email: schema.subscribers.email,
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

    return c.html(
      <AdminLayout title={campaign.subject} user={user} flash={flash}>
        <PageHeader title={campaign.subject} />
        <div class="flex gap-4 items-center mb-4">
          <CampaignBadge status={campaign.status} />
          <span class="text-sm text-gray-500">
            Audience: {audienceDesc} &middot; From: {campaign.fromAddress}
          </span>
        </div>

        {selectedTestIds && (
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 text-sm text-blue-800">
            Test campaign for {selectedTestIds.length} selected{" "}
            {selectedTestIds.length === 1 ? "subscriber" : "subscribers"}. The
            send records below show who actually received it. This campaign was
            not sent to the full list.
          </div>
        )}

        {campaign.scheduledAt && (
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 text-sm text-blue-800">
            Scheduled for: {fmtDateTime(campaign.scheduledAt)}
            {campaign.batchSize && (
              <span class="ml-4">
                Batch: {campaign.batchSize} emails every{" "}
                {campaign.batchInterval ?? 10} minutes
              </span>
            )}
          </div>
        )}

        {campaign.lastError && (
          <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 font-mono text-sm whitespace-pre-wrap break-all text-red-800">
            <strong>Error:</strong>
            {"\n"}
            {campaign.lastError}
          </div>
        )}

        {(campaign.status === "draft" ||
          campaign.status === "failed" ||
          campaign.status === "scheduled") && (
          <div class="flex gap-2 mb-6">
            <LinkButton href={`/admin/campaigns/${id}/edit`}>
              Edit Campaign
            </LinkButton>
          </div>
        )}

        {campaign.status === "draft" && (
          <form
            method="post"
            action={`/admin/campaigns/${id}/send`}
            class="mb-6"
          >
            <Button type="submit" variant="danger">
              Send Campaign
            </Button>
          </form>
        )}

        {campaign.status === "scheduled" && (
          <div class="flex gap-2 mb-6">
            <form method="post" action={`/admin/campaigns/${id}/unschedule`}>
              <Button type="submit" variant="secondary">
                Unschedule (revert to draft)
              </Button>
            </form>
          </div>
        )}

        {campaign.status === "failed" && (
          <div class="flex gap-2 mb-6">
            <form method="post" action={`/admin/campaigns/${id}/retry`}>
              <Button type="submit">Retry (skip already sent)</Button>
            </form>
            <form method="post" action={`/admin/campaigns/${id}/reset`}>
              <button
                type="submit"
                class="inline-block px-4 py-2 bg-gray-500 text-white text-sm font-medium rounded-md hover:bg-gray-600 cursor-pointer border-none no-underline"
              >
                Reset to Draft
              </button>
            </form>
          </div>
        )}

        {campaign.status === "sending" && (
          <div class="flex gap-2 mb-6">
            <form method="post" action={`/admin/campaigns/${id}/reset`}>
              <button
                type="submit"
                class="inline-block px-4 py-2 bg-gray-500 text-white text-sm font-medium rounded-md hover:bg-gray-600 cursor-pointer border-none no-underline"
              >
                Force Reset to Draft (stuck?)
              </button>
            </form>
          </div>
        )}

        {sends.length > 0 && (
          <>
            <h2 class="text-xl font-semibold mt-6 mb-3">
              Sends ({sends.length})
            </h2>
            <Table>
              <thead>
                <tr>
                  <Th>Subscriber</Th>
                  <Th>Status</Th>
                  <Th>Attempts</Th>
                  <Th>Accepted / Delivered</Th>
                  <Th>SES Message ID</Th>
                </tr>
              </thead>
              <tbody>
                {sends.map(({ send, email }) => (
                  <tr>
                    <Td>
                      <a
                        href={`/admin/subscribers/${send.subscriberId}`}
                        class="text-blue-600 hover:text-blue-800"
                      >
                        {email
                          ? Html.escapeHtml(email)
                          : `Subscriber #${send.subscriberId}`}
                      </a>
                      <span class="block text-xs text-gray-500">
                        ID {send.subscriberId}
                      </span>
                    </Td>
                    <Td>{send.status}</Td>
                    <Td>{send.attemptCount}</Td>
                    <Td>
                      <span class="block">
                        {fmtDateTime(send.acceptedAt ?? send.sentAt)}
                      </span>
                      {send.deliveredAt && (
                        <span class="block text-xs text-green-700">
                          Delivered {fmtDateTime(send.deliveredAt)}
                        </span>
                      )}
                      {send.nextAttemptAt && (
                        <span class="block text-xs text-amber-700">
                          Retry {fmtDateTime(send.nextAttemptAt)}
                        </span>
                      )}
                      {send.lastError && (
                        <span
                          class="block text-xs text-red-700"
                          title={send.diagnosticCode ?? undefined}
                        >
                          {send.lastError}
                        </span>
                      )}
                    </Td>
                    <Td class="text-xs">{send.sesMessageId ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}

        <h2 class="text-xl font-semibold mt-6 mb-3">Email Preview</h2>
        <div class="mb-4">
          <select
            id="previewSubscriber"
            class="px-3 py-2 border border-gray-300 rounded-md text-sm font-[inherit] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Generic preview</option>
            {previewSubscribers.map((sub) => (
              <option value={String(sub.id)}>{sub.email}</option>
            ))}
          </select>
        </div>
        <iframe
          id="previewFrame"
          sandbox=""
          src={`/admin/campaigns/${id}/preview`}
          class="w-full border border-gray-200 rounded-lg"
          style="min-height: 600px;"
        />
        <script>{`
          document.getElementById('previewSubscriber').addEventListener('change', function() {
            var subId = this.value;
            var src = '/admin/campaigns/${id}/preview';
            if (subId) src += '?subscriberId=' + subId;
            document.getElementById('previewFrame').src = src;
          });
        `}</script>

        {inboundReplies.length > 0 && (
          <>
            <h2 class="text-xl font-semibold mt-6 mb-3">
              Replies ({inboundReplies.length})
            </h2>
            <Table>
              <thead>
                <tr>
                  <Th>From</Th>
                  <Th>Subject</Th>
                  <Th>Received</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {inboundReplies.map((r) => (
                  <tr>
                    <Td>{r.fromAddr}</Td>
                    <Td>{r.subject}</Td>
                    <Td>{fmtDateTime(r.createdAt)}</Td>
                    <Td>
                      <a
                        href={`/admin/inbound/${r.id}`}
                        class="text-blue-600 hover:text-blue-800"
                      >
                        View
                      </a>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}

        <hr class="my-8" />
        <form
          method="post"
          action={`/admin/campaigns/${id}/delete`}
          onsubmit="return confirm('Delete this campaign and all its send records? This cannot be undone.')"
        >
          <Button type="submit" variant="danger">
            Delete Campaign
          </Button>
        </form>
      </AdminLayout>,
    );
  });

  app.get("/campaigns/:id/edit", (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    const id = Number(c.params.id);
    const campaign = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .get();
    if (!campaign) return c.notFound();
    if (
      campaign.status !== "draft" &&
      campaign.status !== "failed" &&
      campaign.status !== "scheduled"
    ) {
      return c.redirect(`/admin/campaigns/${id}`);
    }

    const allLists = getAccessibleLists(db, user);

    const allTags = db.select().from(schema.tags).all();
    const allSubscribers = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.status, "active"))
      .all();

    return c.html(
      <CampaignEditorPage
        user={user}
        flash={flash}
        config={config}
        lists={allLists}
        tags={allTags}
        subscribers={allSubscribers}
        campaign={campaign}
        templates={activeTemplateChoices(db)}
      />,
    );
  });

  app.post(
    "/campaigns/:id/edit",
    async (c) => {
      const user = c.user as User;
      const id = Number(c.params.id);
      const campaign = db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, id))
        .get();
      if (!campaign) return c.notFound();
      if (
        campaign.status !== "draft" &&
        campaign.status !== "failed" &&
        campaign.status !== "scheduled"
      ) {
        return c.redirect(`/admin/campaigns/${id}`);
      }

      try {
        await updateCampaignFromEditor(db, config, user, id, c.body);
      } catch (error) {
        if (error instanceof CampaignEditorAccessError)
          return c.text("Forbidden", 403);
        if (error instanceof CampaignEditorReferenceError)
          return c.text(error.message, 400);
        if (error instanceof TemplateValidationError)
          return c.text(error.message, 400);
        throw error;
      }

      logEvent(db, {
        type: "admin.campaign_edited",
        detail: c.body.subject,
        campaignId: id,
        userId: user.id,
      });

      setFlash(c, "Campaign saved.");
      return c.redirect(`/admin/campaigns/${id}`);
    },
    { body: CampaignEditorFormSchema },
  );

  app.post("/campaigns/:id/send", async (c) => {
    const id = Number(c.params.id);
    try {
      await sendCampaign(db, config, id);
    } catch {
      // error is recorded in campaign.lastError by sender
    }
    setFlash(c, "Campaign is sending.");
    return c.redirect(`/admin/campaigns/${id}`);
  });

  app.post("/campaigns/:id/retry", async (c) => {
    const id = Number(c.params.id);
    try {
      await sendCampaign(db, config, id);
    } catch {
      // error is recorded in campaign.lastError by sender
    }
    setFlash(c, "Campaign retrying.");
    return c.redirect(`/admin/campaigns/${id}`);
  });

  app.post("/campaigns/:id/reset", (c) => {
    const id = Number(c.params.id);
    db.update(schema.campaigns)
      .set({ status: "draft", lastError: null })
      .where(eq(schema.campaigns.id, id))
      .run();
    setFlash(c, "Campaign reset to draft.");
    return c.redirect(`/admin/campaigns/${id}`);
  });

  app.post("/campaigns/:id/unschedule", (c) => {
    const id = Number(c.params.id);
    db.update(schema.campaigns)
      .set({ status: "draft", scheduledAt: null })
      .where(eq(schema.campaigns.id, id))
      .run();
    setFlash(c, "Campaign unscheduled.");
    return c.redirect(`/admin/campaigns/${id}`);
  });

  app.post("/campaigns/:id/delete", async (c) => {
    const user = c.user as User;
    const id = Number(c.params.id);
    const campaign = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .get();
    if (!campaign) return c.notFound();

    // Media storage is required infrastructure. Do not delete the database
    // record unless its associated objects can be cleaned up successfully.
    await deleteCampaignS3Images(id, config);

    db.transaction((tx) => {
      // Preserve related history without retaining foreign keys to the campaign.
      tx.update(schema.messages)
        .set({ campaignId: null })
        .where(eq(schema.messages.campaignId, id))
        .run();
      tx.update(schema.events)
        .set({ campaignId: null })
        .where(eq(schema.events.campaignId, id))
        .run();
      tx.delete(schema.campaignSends)
        .where(eq(schema.campaignSends.campaignId, id))
        .run();
      tx.delete(schema.campaigns).where(eq(schema.campaigns.id, id)).run();
      tx.insert(schema.events)
        .values({
          type: "admin.campaign_deleted",
          detail: campaign.subject,
          userId: user.id,
          meta: JSON.stringify({ campaignId: id }),
        })
        .run();
    });
    setFlash(c, "Campaign deleted.");
    return c.redirect("/admin/campaigns");
  });
}
