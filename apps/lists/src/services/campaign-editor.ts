import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Config } from "../config";
import type { Db } from "../db";
import { schema } from "../db";
import { canAccessList } from "../auth";
import { processPendingS3Images } from "./images";
import { renderTemplate } from "./email-templates";

const optionalPositiveInteger = z
  .union([z.literal(""), z.coerce.number().int().positive()])
  .default("")
  .transform((value) => (value === "" ? null : value));

const pendingImages = z
  .string()
  .default("{}")
  .transform((value, context): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(value);
      return z.record(z.string(), z.string()).parse(parsed);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Invalid pending image data",
      });
      return z.NEVER;
    }
  });
const templateSections = z
  .string()
  .max(5_000_000)
  .default("{}")
  .transform((value, context): Record<string, string> => {
    try {
      return z
        .record(z.string(), z.string().max(1_000_000))
        .refine(
          (sections) => Object.keys(sections).length <= 50,
          "At most 50 template sections are supported",
        )
        .parse(JSON.parse(value));
    } catch {
      context.addIssue({
        code: "custom",
        message: "Invalid template section data",
      });
      return z.NEVER;
    }
  });

export const CampaignEditorFormSchema = z
  .object({
    fromAddress: z.string().trim().min(1),
    fromName: z
      .string()
      .trim()
      .default("")
      .transform((value) => value || null),
    subject: z.string().trim().min(1),
    bodyMarkdown: z.string().min(1),
    audienceMode: z.enum(["list", "all", "tag", "specific"]),
    listId: z.string().default(""),
    tagId: z.string().default(""),
    subscriberIds: z.string().default(""),
    scheduledAt: z
      .string()
      .default("")
      .transform((value, context) => {
        if (!value) return null;
        const timestamp = Date.parse(value);
        if (Number.isNaN(timestamp)) {
          context.addIssue({
            code: "custom",
            message: "Invalid scheduled date",
          });
          return z.NEVER;
        }
        return new Date(timestamp).toISOString();
      }),
    batchSize: optionalPositiveInteger,
    batchInterval: optionalPositiveInteger,
    pendingImagesJson: pendingImages,
    templateSlug: z.string().min(1).default("newsletter"),
    templateSectionsJson: templateSections,
    fromPersona: z.string().optional(),
  })
  .transform((form, context) => {
    const invalid = (message: string): never => {
      context.addIssue({ code: "custom", message });
      return z.NEVER;
    };

    let audience: CampaignAudience;
    if (form.audienceMode === "list") {
      const id = Number(form.listId);
      audience =
        Number.isInteger(id) && id > 0
          ? { type: "list", id }
          : invalid("Select a list");
    } else if (form.audienceMode === "tag") {
      const id = Number(form.tagId);
      audience =
        Number.isInteger(id) && id > 0
          ? { type: "tag", id }
          : invalid("Select a tag");
    } else if (form.audienceMode === "specific") {
      const ids = [
        ...new Set(
          form.subscriberIds
            .split(",")
            .map(Number)
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      ];
      audience =
        ids.length > 0
          ? { type: "subscribers", ids }
          : invalid("Select at least one subscriber");
    } else {
      audience = { type: "all" };
    }

    return {
      fromAddress: form.fromAddress,
      fromName: form.fromName,
      subject: form.subject,
      bodyMarkdown: form.bodyMarkdown,
      audience,
      scheduledAt: form.scheduledAt,
      batchSize: form.batchSize,
      batchInterval: form.batchInterval,
      pendingImages: form.pendingImagesJson,
      templateSlug: form.templateSlug,
      templateSections: form.templateSectionsJson,
    };
  });

type CampaignAudience =
  | { type: "list"; id: number }
  | { type: "tag"; id: number }
  | { type: "subscribers"; ids: number[] }
  | { type: "all" };

export type CampaignEditorForm = z.output<typeof CampaignEditorFormSchema>;

export class CampaignEditorAccessError extends Error {}
export class CampaignEditorReferenceError extends Error {}

function audienceColumns(audience: CampaignAudience) {
  if (audience.type === "list" || audience.type === "tag") {
    return {
      audienceType: audience.type,
      audienceId: audience.id,
      audienceData: null,
    };
  }
  if (audience.type === "subscribers") {
    return {
      audienceType: "subscribers" as const,
      audienceId: null,
      audienceData: JSON.stringify(audience.ids),
    };
  }
  return { audienceType: "all" as const, audienceId: null, audienceData: null };
}

function assertAudienceAccess(
  db: Db,
  user: { id: number; role: string },
  audience: CampaignAudience,
) {
  if (audience.type === "list") {
    const list = db
      .select({ id: schema.lists.id })
      .from(schema.lists)
      .where(eq(schema.lists.id, audience.id))
      .get();
    if (!list) throw new CampaignEditorReferenceError("List not found");
    if (!canAccessList(db, user, audience.id))
      throw new CampaignEditorAccessError("List access denied");
    return;
  }
  if (user.role !== "owner" && user.role !== "admin") {
    throw new CampaignEditorAccessError(
      "Only owners and admins can use non-list audiences",
    );
  }
  if (audience.type === "tag") {
    const tag = db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(eq(schema.tags.id, audience.id))
      .get();
    if (!tag) throw new CampaignEditorReferenceError("Tag not found");
  }
  if (audience.type === "subscribers") {
    const rows = db
      .select({ id: schema.subscribers.id })
      .from(schema.subscribers)
      .where(
        and(
          inArray(schema.subscribers.id, audience.ids),
          eq(schema.subscribers.status, "active"),
        ),
      )
      .all();
    if (rows.length !== audience.ids.length)
      throw new CampaignEditorReferenceError(
        "One or more subscribers are unavailable",
      );
  }
}

function resolveTemplate(db: Db, form: CampaignEditorForm) {
  const template = db
    .select()
    .from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.slug, form.templateSlug))
    .get();
  if (!template || template.status !== "active")
    throw new CampaignEditorReferenceError("Email template is not active");
  return template;
}

function campaignValues(
  form: CampaignEditorForm,
  bodyMarkdown: string,
  template: ReturnType<typeof resolveTemplate>,
) {
  return {
    ...audienceColumns(form.audience),
    fromAddress: form.fromAddress,
    fromName: form.fromName,
    subject: form.subject,
    bodyMarkdown,
    scheduledAt: form.scheduledAt,
    batchSize: form.batchSize,
    batchInterval: form.batchInterval,
    status: form.scheduledAt ? ("scheduled" as const) : ("draft" as const),
    templateSlug: template.slug,
    templateSections: JSON.stringify({
      ...form.templateSections,
      content: bodyMarkdown,
    }),
  };
}

async function validateCampaignContent(
  template: ReturnType<typeof resolveTemplate>,
  form: CampaignEditorForm,
) {
  await renderTemplate(template, {
    subscriber: {
      email: "reader@example.com",
      firstName: "Jane",
      lastName: "Doe",
    },
    campaign: { subject: form.subject },
    list: { name: "Preview" },
    links: { unsubscribe: "#unsubscribe", preferences: "#preferences" },
    sectionSources: { ...form.templateSections, content: form.bodyMarkdown },
  });
}

export async function createCampaignFromEditor(
  db: Db,
  config: Config,
  user: { id: number; role: string },
  form: CampaignEditorForm,
) {
  assertAudienceAccess(db, user, form.audience);
  const template = resolveTemplate(db, form);
  await validateCampaignContent(template, form);
  const campaign = db
    .insert(schema.campaigns)
    .values(campaignValues(form, form.bodyMarkdown, template))
    .returning()
    .get();
  try {
    const markdown =
      config.s3MediaBucket && Object.keys(form.pendingImages).length > 0
        ? await processPendingS3Images(
            form.bodyMarkdown,
            campaign.id,
            form.pendingImages,
            config,
          )
        : form.bodyMarkdown;
    if (markdown !== form.bodyMarkdown)
      db.update(schema.campaigns)
        .set({
          bodyMarkdown: markdown,
          templateSections: JSON.stringify({
            ...form.templateSections,
            content: markdown,
          }),
        })
        .where(eq(schema.campaigns.id, campaign.id))
        .run();
    return { ...campaign, bodyMarkdown: markdown };
  } catch (error) {
    db.delete(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .run();
    throw error;
  }
}

export async function updateCampaignFromEditor(
  db: Db,
  config: Config,
  user: { id: number; role: string },
  id: number,
  form: CampaignEditorForm,
) {
  assertAudienceAccess(db, user, form.audience);
  const template = resolveTemplate(db, form);
  await validateCampaignContent(template, form);
  const markdown =
    config.s3MediaBucket && Object.keys(form.pendingImages).length > 0
      ? await processPendingS3Images(
          form.bodyMarkdown,
          id,
          form.pendingImages,
          config,
        )
      : form.bodyMarkdown;
  db.update(schema.campaigns)
    .set(campaignValues(form, markdown, template))
    .where(eq(schema.campaigns.id, id))
    .run();
}
