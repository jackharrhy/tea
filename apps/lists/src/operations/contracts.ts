import { z } from "zod";

export const emptyInput = z.object({}).strict();
export const idInput = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();
export const paginationInput = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const subscriberListInput = paginationInput.extend({
  status: z.enum(["active", "blocklisted"]).optional(),
  listId: z.coerce.number().int().positive().optional(),
  membershipStatus: z
    .enum(["unconfirmed", "confirmed", "unsubscribed"])
    .optional(),
  search: z.string().trim().max(255).optional(),
});

export const subscriberCreateInput = z
  .object({
    email: z.email(),
    firstName: z.string().max(255).optional(),
    lastName: z.string().max(255).optional(),
    name: z.string().max(255).optional(),
    lists: z.array(z.string().min(1)).min(1),
    sendConfirmation: z.boolean().optional(),
  })
  .strict();

export const subscriberDeleteInput = idInput.extend({
  confirm: z.literal(true),
});
export const subscriberUnsubscribeInput = idInput.extend({
  listId: z.coerce.number().int().positive(),
  confirm: z.literal(true),
});

const campaignBaseInput = z.object({
  subject: z.string().min(1),
  bodyMarkdown: z.string().min(1),
  fromAddress: z.email(),
  fromName: z.string().optional().nullable(),
  templateSlug: z.string().min(1).optional(),
  templateSections: z.record(z.string(), z.string()).optional(),
});

export const campaignCreateInput = z.discriminatedUnion("audienceType", [
  campaignBaseInput
    .extend({
      audienceType: z.literal("list"),
      audienceId: z.coerce.number().int().positive(),
    })
    .strict(),
  campaignBaseInput
    .extend({
      audienceType: z.literal("tag"),
      audienceId: z.coerce.number().int().positive(),
    })
    .strict(),
  campaignBaseInput
    .extend({
      audienceType: z.literal("all"),
      audienceId: z.null().optional(),
    })
    .strict(),
  campaignBaseInput
    .extend({
      audienceType: z.literal("subscribers"),
      audienceId: z.null().optional(),
      audienceData: z.array(z.coerce.number().int().positive()).min(1),
    })
    .strict(),
]);

export const campaignSendInput = idInput.extend({ confirm: z.literal(true) });
export const campaignTestSendInput = idInput.extend({
  subscriberIds: z.array(z.coerce.number().int().positive()).min(1).max(20),
  confirm: z.literal(true),
});
export const campaignUpdateInput = z
  .object({ id: idInput.shape.id, campaign: campaignCreateInput })
  .strict();

const templateSourceText = z.string().max(1_000_000);
const templatePartialsInput = z
  .record(z.string(), z.string().max(250_000))
  .refine(
    (partials) =>
      Object.keys(partials).length <= 50 &&
      Object.values(partials).reduce((size, value) => size + value.length, 0) <=
        1_000_000,
    "Templates support at most 50 partials and 1 MB of partial source",
  );

const templateSectionInput = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    name: z.string().min(1).max(120),
    format: z.enum(["markdown", "html", "text"]),
    required: z.boolean().default(false),
  })
  .strict();

const templateSourceShape = {
  sourceFormat: z.enum(["html", "mjml", "text"]),
  subjectSource: z.string().max(1_000).optional().nullable(),
  htmlSource: templateSourceText.optional().nullable(),
  textSource: templateSourceText.min(1),
  sections: z.array(templateSectionInput).max(50),
  partials: templatePartialsInput.default({}),
} as const;

export const templateSourceInput = z.object(templateSourceShape).strict();

export const templateCreateInput = z
  .object({
    ...templateSourceShape,
    slug: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(80),
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional().nullable(),
  })
  .strict();
export const templateUpdateInput = z
  .object({
    ...templateSourceShape,
    slug: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(80),
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).optional().nullable(),
  })
  .strict();
export const templateSlugInput = z.object({ slug: z.string().min(1) }).strict();
export const templateArchiveInput = templateSlugInput.extend({
  confirm: z.literal(true),
});
export const templateDuplicateInput = templateSlugInput.extend({
  newSlug: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .max(80),
  newName: z.string().min(1).max(120).optional(),
});
export const templatePreviewInput = templateSlugInput.extend({
  sectionSources: z
    .record(z.string(), z.string().max(1_000_000))
    .refine(
      (sections) => Object.keys(sections).length <= 50,
      "At most 50 sections are supported",
    )
    .default({}),
});

export const templateSummaryOutput = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(["draft", "active", "archived"]),
  builtIn: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const templateDetailOutput = templateSummaryOutput.extend({
  sourceFormat: z.enum(["html", "mjml", "text"]),
  subjectSource: z.string().nullable(),
  htmlSource: z.string().nullable(),
  textSource: z.string(),
  compiledHtml: z.string().nullable(),
  sections: z.array(templateSectionInput),
  partials: z.record(z.string(), z.string()),
});
export const templatePreviewOutput = z.object({
  subject: z.string(),
  html: z.string().nullable(),
  text: z.string(),
  previewUrl: z.string(),
});
export const templateValidationOutput = z.object({
  valid: z.literal(true),
  compiledHtml: z.string().nullable(),
});

export const listOutput = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  fromDomain: z.string(),
  fromAddress: z.string(),
});

export const subscriberSummaryOutput = z.object({
  id: z.number(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  status: z.enum(["active", "blocklisted"]),
  createdAt: z.string(),
  membershipStatus: z
    .enum(["unconfirmed", "confirmed", "unsubscribed"])
    .nullable(),
});

export const subscriberOutput = subscriberSummaryOutput.extend({
  memberships: z.array(
    z.object({
      listId: z.number(),
      listSlug: z.string(),
      listName: z.string(),
      status: z.enum(["unconfirmed", "confirmed", "unsubscribed"]),
      subscribedAt: z.string(),
    }),
  ),
});

export const subscriberCreatedOutput = z.object({
  id: z.number(),
  email: z.string(),
});
export const subscriberDeletedOutput = z.object({
  id: z.number(),
  deleted: z.literal(true),
});
export const subscriberUnsubscribedOutput = z.object({
  id: z.number(),
  listId: z.number(),
  status: z.literal("unsubscribed"),
});

export const listStatsOutput = z.object({
  listId: z.number(),
  confirmed: z.number(),
  unconfirmed: z.number(),
  unsubscribed: z.number(),
});

export const campaignOutput = z.object({
  id: z.number(),
  subject: z.string(),
  bodyMarkdown: z.string(),
  templateSlug: z.string(),
  templateSections: z.string(),
  fromAddress: z.string(),
  fromName: z.string().nullable(),
  audienceType: z.enum(["list", "tag", "all", "subscribers"]),
  audienceId: z.number().nullable(),
  audienceData: z.string().nullable(),
  status: z.enum(["draft", "scheduled", "sending", "sent", "failed"]),
  scheduledAt: z.string().nullable(),
  batchSize: z.number().nullable(),
  batchInterval: z.number().nullable(),
  lastError: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});

export const campaignDetailOutput = campaignOutput.extend({
  deliveryCounts: z.record(z.string(), z.number()),
});
export const campaignSendsInput = idInput.extend(paginationInput.shape);
export const campaignSendOutput = z.object({
  id: z.number(),
  subscriberId: z.number(),
  email: z.string().nullable(),
  status: z.string(),
  attemptCount: z.number(),
  acceptedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export const campaignPreviewOutput = z.object({
  subject: z.string(),
  html: z.string().nullable(),
  text: z.string(),
});

export const deliverabilityOutput = z.object({
  sends: z.record(z.string(), z.number()),
  events: z.record(z.string(), z.number()),
});

export const dmarcOutput = z.array(
  z.object({
    domain: z.string(),
    reports: z.number(),
    messages: z.number(),
    latest: z.string().nullable(),
  }),
);

export const apiErrorOutput = z.object({ error: z.string() });
export const dataOutput = <S extends z.ZodType>(schema: S) =>
  z.object({ data: schema });

export type CreateSubscriberInput = z.output<typeof subscriberCreateInput>;
export type CreateCampaignDraftInput = z.output<typeof campaignCreateInput>;
export type UpdateCampaignDraftInput = z.output<typeof campaignUpdateInput>;
