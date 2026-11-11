import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { createController } from "remix/router";
import { z } from "zod";

import { canAccessList, getAccessibleListIds, getAccessibleLists } from "../src/auth.ts";
import { buildPreferencesUrl, buildUnsubscribeUrl } from "../src/compliance.ts";
import type { Config } from "../src/config.ts";
import { schema, type Db } from "../src/db/index.ts";
import {
  CampaignEditorAccessError,
  CampaignEditorFormSchema,
  CampaignEditorReferenceError,
  createCampaignFromEditor,
  updateCampaignFromEditor,
} from "../src/services/campaign-editor.ts";
import { renderCampaignMessage } from "../src/services/campaign-renderer.ts";
import { TemplateValidationError } from "../src/services/email-templates.ts";
import { logEvent } from "../src/services/events.ts";
import { deleteCampaignS3Images, processImage } from "../src/services/images.ts";
import { sendCampaign } from "../src/services/sender.ts";
import {
  CampaignDetail,
  CampaignEditor,
  CampaignIndex,
  previewResponse,
  textPreview,
} from "./admin-campaign-pages.tsx";
import type { Viewer } from "./admin.tsx";
import { routes } from "./routes.ts";

type User = Pick<typeof schema.users.$inferSelect, "id" | "role" | "name" | "email">;
type Campaign = typeof schema.campaigns.$inferSelect;
const PAGE_SIZE = 25;
function viewer(user: User): Viewer {
  return { name: user.name ?? user.email, isAdmin: user.role !== "member" };
}
function id(raw: string) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
function redirect(path: string) {
  return new Response(null, { status: 303, headers: { Location: path } });
}

export function createAdminCampaignsController(db: Db, config: Config, user: User) {
  const account = viewer(user);
  const access = getAccessibleListIds(db, user);
  const options = () => ({
    lists: getAccessibleLists(db, user),
    tags: account.isAdmin ? db.select().from(schema.tags).all() : [],
    subscribers: account.isAdmin
      ? db
          .select({
            id: schema.subscribers.id,
            email: schema.subscribers.email,
            firstName: schema.subscribers.firstName,
            lastName: schema.subscribers.lastName,
          })
          .from(schema.subscribers)
          .where(eq(schema.subscribers.status, "active"))
          .all()
      : [],
    templates: db
      .select()
      .from(schema.emailTemplates)
      .where(eq(schema.emailTemplates.status, "active"))
      .all(),
  });
  function getVisible(raw: string) {
    const campaignId = id(raw);
    if (!campaignId) return { error: new Response("Not Found", { status: 404 }) } as const;
    const campaign = db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .get();
    if (!campaign) return { error: new Response("Not Found", { status: 404 }) } as const;
    if (
      access !== "all" &&
      (campaign.audienceType !== "list" ||
        !campaign.audienceId ||
        !canAccessList(db, user, campaign.audienceId))
    )
      return { error: new Response("Forbidden", { status: 403 }) } as const;
    return { campaign } as const;
  }
  async function editorForm(request: Request, campaign?: Campaign) {
    const data = await request.formData();
    const parsed = CampaignEditorFormSchema.safeParse(Object.fromEntries(data));
    if (!parsed.success)
      return {
        error: new Response(parsed.error.issues[0]?.message ?? "Invalid campaign", { status: 400 }),
      } as const;
    try {
      const savedId = campaign
        ? (await updateCampaignFromEditor(db, config, user, campaign.id, parsed.data), campaign.id)
        : (await createCampaignFromEditor(db, config, user, parsed.data)).id;
      logEvent(db, {
        type: campaign ? "admin.campaign_edited" : "admin.campaign_created",
        detail: parsed.data.subject,
        campaignId: savedId,
        userId: user.id,
      });
      return { savedId } as const;
    } catch (error) {
      const status =
        error instanceof CampaignEditorAccessError
          ? 403
          : error instanceof CampaignEditorReferenceError ||
              error instanceof TemplateValidationError
            ? 400
            : 500;
      if (status === 500) console.error(error);
      return {
        error: new Response(
          status === 500
            ? "Campaign could not be saved"
            : error instanceof Error
              ? error.message
              : "Invalid campaign",
          { status },
        ),
      } as const;
    }
  }
  async function send(raw: string) {
    const found = getVisible(raw);
    if (found.error) return found.error;
    try {
      await sendCampaign(db, config, found.campaign.id);
    } catch {
      /* sender records durable failure status */
    }
    return redirect(`/admin/campaigns/${found.campaign.id}`);
  }
  return createController(routes.admin.campaigns, {
    actions: {
      index(context) {
        const search = context.url.searchParams.get("search") ?? "";
        const status = context.url.searchParams.get("status") ?? "";
        const page = Math.max(1, Number(context.url.searchParams.get("page")) || 1);
        const conditions = [];
        if (search) conditions.push(like(schema.campaigns.subject, `%${search}%`));
        if (["draft", "scheduled", "sending", "sent", "failed"].includes(status))
          conditions.push(eq(schema.campaigns.status, status as Campaign["status"]));
        if (access !== "all")
          conditions.push(
            and(
              eq(schema.campaigns.audienceType, "list"),
              inArray(schema.campaigns.audienceId, access.length ? access : [-1]),
            )!,
          );
        const where = conditions.length ? and(...conditions) : undefined;
        const rows = db
          .select()
          .from(schema.campaigns)
          .where(where)
          .orderBy(desc(schema.campaigns.createdAt))
          .limit(PAGE_SIZE)
          .offset((page - 1) * PAGE_SIZE)
          .all();
        const total =
          db
            .select({ count: sql<number>`count(*)` })
            .from(schema.campaigns)
            .where(where)
            .get()?.count ?? 0;
        return context.render(
          <CampaignIndex
            viewer={account}
            rows={rows}
            total={total}
            page={page}
            filters={{ search, status }}
          />,
        );
      },
      new(context) {
        return context.render(<CampaignEditor viewer={account} config={config} {...options()} />);
      },
      async create(context) {
        const result = await editorForm(context.request);
        return result.error ?? redirect(`/admin/campaigns/${result.savedId}`);
      },
      show(context) {
        const found = getVisible(context.params.id);
        if (found.error) return found.error;
        const campaign = found.campaign;
        const listName =
          campaign.audienceType === "list" && campaign.audienceId
            ? db
                .select({ name: schema.lists.name })
                .from(schema.lists)
                .where(eq(schema.lists.id, campaign.audienceId))
                .get()?.name
            : undefined;
        const audience =
          listName ?? (campaign.audienceType === "list" ? "List" : campaign.audienceType);
        const sends = db
          .select({
            email: schema.subscribers.email,
            status: schema.campaignSends.status,
            lastError: schema.campaignSends.lastError,
          })
          .from(schema.campaignSends)
          .innerJoin(
            schema.subscribers,
            eq(schema.campaignSends.subscriberId, schema.subscribers.id),
          )
          .where(eq(schema.campaignSends.campaignId, campaign.id))
          .orderBy(desc(schema.campaignSends.id))
          .limit(100)
          .all();
        const totalRecipients =
          db
            .select({ count: sql<number>`count(*)` })
            .from(schema.campaignSends)
            .where(eq(schema.campaignSends.campaignId, campaign.id))
            .get()?.count ?? 0;
        const selectedTestCount =
          campaign.audienceType === "list" && campaign.audienceData
            ? ((JSON.parse(campaign.audienceData) as { testSubscriberIds?: number[] })
                .testSubscriberIds?.length ?? null)
            : null;
        return context.render(
          <CampaignDetail
            viewer={account}
            campaign={campaign}
            audience={audience}
            sends={sends}
            totalRecipients={totalRecipients}
            selectedTestCount={selectedTestCount}
          />,
        );
      },
      edit(context) {
        const found = getVisible(context.params.id);
        if (found.error) return found.error;
        if (!["draft", "failed", "scheduled"].includes(found.campaign.status))
          return redirect(`/admin/campaigns/${found.campaign.id}`);
        return context.render(
          <CampaignEditor
            viewer={account}
            config={config}
            {...options()}
            campaign={found.campaign}
          />,
        );
      },
      async update(context) {
        const found = getVisible(context.params.id);
        if (found.error) return found.error;
        if (!["draft", "failed", "scheduled"].includes(found.campaign.status))
          return redirect(`/admin/campaigns/${found.campaign.id}`);
        const result = await editorForm(context.request, found.campaign);
        return result.error ?? redirect(`/admin/campaigns/${found.campaign.id}`);
      },
      async preview(context) {
        const found = getVisible(context.params.id);
        if (found.error) return found.error;
        const campaign = found.campaign;
        const list =
          campaign.audienceType === "list" && campaign.audienceId
            ? db.select().from(schema.lists).where(eq(schema.lists.id, campaign.audienceId)).get()
            : null;
        let subscriber: { email: string; firstName?: string | null; lastName?: string | null } = {
          email: "subscriber@example.com",
          firstName: "Jane",
          lastName: "Doe",
        };
        let unsubscribe = "#unsubscribe",
          preferences = "#preferences";
        const subscriberId = id(context.url.searchParams.get("subscriberId") ?? "");
        if (subscriberId) {
          const selected = db
            .select()
            .from(schema.subscribers)
            .where(eq(schema.subscribers.id, subscriberId))
            .get();
          if (selected) {
            subscriber = selected;
            unsubscribe = buildUnsubscribeUrl(
              config.baseUrl,
              selected.unsubscribeToken,
              campaign.audienceType === "list" ? (campaign.audienceId ?? undefined) : undefined,
            );
            preferences = buildPreferencesUrl(config.baseUrl, selected.unsubscribeToken);
          }
        }
        const rendered = await renderCampaignMessage(db, {
          campaign,
          subscriber,
          list: { name: list?.name ?? "Newsletter" },
          links: { unsubscribe, preferences },
        });
        return previewResponse(rendered.html ?? textPreview(rendered.text));
      },
      async previewDraft(context) {
        let body: unknown;
        try {
          body = await context.request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const parsed = z
          .object({
            bodyMarkdown: z.string().default(""),
            subject: z.string().default("Preview"),
            listName: z.string().default("Newsletter"),
            templateSlug: z.string().default("newsletter"),
            templateSections: z.record(z.string(), z.string()).default({}),
          })
          .safeParse(body);
        if (!parsed.success) return new Response("Invalid preview", { status: 400 });
        const rendered = await renderCampaignMessage(db, {
          campaign: {
            subject: parsed.data.subject,
            bodyMarkdown: parsed.data.bodyMarkdown,
            templateSlug: parsed.data.templateSlug,
            templateSections: JSON.stringify(parsed.data.templateSections),
          },
          subscriber: { firstName: "Jane", lastName: "Doe", email: "subscriber@example.com" },
          list: { name: parsed.data.listName },
          links: { unsubscribe: "#unsubscribe", preferences: "#preferences" },
        });
        return previewResponse(rendered.html ?? textPreview(rendered.text));
      },
      async uploadImage(context) {
        const data = await context.request.formData();
        const file = data.get("image");
        if (!(file instanceof File) || !file.type.startsWith("image/") || file.size > 20_000_000)
          return Response.json({ error: "Invalid image" }, { status: 400 });
        try {
          const image = await processImage(await file.arrayBuffer());
          return Response.json({ ...image, originalSizeBytes: file.size });
        } catch {
          return Response.json({ error: "Failed to process image" }, { status: 400 });
        }
      },
      send(context) {
        return send(context.params.id);
      },
      retry(context) {
        return send(context.params.id);
      },
      reset(context) {
        const found = getVisible(context.params.id);
        if (found.error) return found.error;
        if (found.campaign.status !== "failed")
          return new Response("Cannot reset campaign", { status: 409 });
        db.update(schema.campaigns)
          .set({ status: "draft", lastError: null })
          .where(eq(schema.campaigns.id, found.campaign.id))
          .run();
        return redirect(`/admin/campaigns/${found.campaign.id}`);
      },
      unschedule(context) {
        const found = getVisible(context.params.id);
        if (found.error) return found.error;
        if (found.campaign.status !== "scheduled")
          return new Response("Campaign is not scheduled", { status: 409 });
        db.update(schema.campaigns)
          .set({ status: "draft", scheduledAt: null })
          .where(eq(schema.campaigns.id, found.campaign.id))
          .run();
        return redirect(`/admin/campaigns/${found.campaign.id}`);
      },
      async destroy(context) {
        const found = getVisible(context.params.id);
        if (found.error) return found.error;
        const campaign = found.campaign;
        await deleteCampaignS3Images(campaign.id, config);
        db.transaction((tx) => {
          tx.update(schema.messages)
            .set({ campaignId: null })
            .where(eq(schema.messages.campaignId, campaign.id))
            .run();
          tx.update(schema.events)
            .set({ campaignId: null })
            .where(eq(schema.events.campaignId, campaign.id))
            .run();
          tx.delete(schema.campaignSends)
            .where(eq(schema.campaignSends.campaignId, campaign.id))
            .run();
          tx.delete(schema.campaigns).where(eq(schema.campaigns.id, campaign.id)).run();
          logEvent(tx, {
            type: "admin.campaign_deleted",
            detail: campaign.subject,
            meta: { campaignId: campaign.id },
            userId: user.id,
          });
        });
        return redirect("/admin/campaigns");
      },
    },
  });
}
