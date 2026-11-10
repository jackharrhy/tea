import { z } from "zod";
import type { OperationContext } from ".";
import {
  createCampaignDraft,
  createSubscriberOperation,
  deleteSubscriber,
  getCampaign,
  getDeliverabilitySummary,
  getDmarcSummary,
  getListStats,
  getSubscriber,
  listCampaigns,
  listCampaignSends,
  listLists,
  listSubscribers,
  previewCampaign,
  sendCampaignOperation,
  sendCampaignTestOperation,
  unsubscribeSubscriber,
  updateCampaignDraft,
} from ".";
import {
  archiveTemplate,
  createTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  previewTemplate,
  updateTemplate,
  validateTemplateSource,
} from "./templates";
import {
  campaignCreateInput,
  campaignDetailOutput,
  campaignOutput,
  campaignSendOutput,
  campaignSendsInput,
  campaignPreviewOutput,
  campaignSendInput,
  campaignTestSendInput,
  campaignUpdateInput,
  deliverabilityOutput,
  dmarcOutput,
  emptyInput,
  idInput,
  listOutput,
  listStatsOutput,
  paginationInput,
  subscriberCreateInput,
  subscriberCreatedOutput,
  subscriberDeleteInput,
  subscriberDeletedOutput,
  subscriberListInput,
  subscriberOutput,
  subscriberSummaryOutput,
  subscriberUnsubscribeInput,
  subscriberUnsubscribedOutput,
  templateArchiveInput,
  templateCreateInput,
  templateDetailOutput,
  templatePreviewInput,
  templatePreviewOutput,
  templateDuplicateInput,
  templateSlugInput,
  templateSummaryOutput,
  templateSourceInput,
  templateUpdateInput,
  templateValidationOutput,
} from "./contracts";

type OperationDefinition<S extends z.ZodType, O extends z.ZodType> = {
  mcpName: string;
  description: string;
  input: S;
  output: O;
  run: (ctx: OperationContext, input: z.output<S>) => Promise<z.output<O>>;
  execute: (ctx: OperationContext, input: unknown) => Promise<z.output<O>>;
};

function defineOperation<S extends z.ZodType, O extends z.ZodType>(definition: {
  mcpName: string;
  description: string;
  input: S;
  output: O;
  run: (
    ctx: OperationContext,
    input: z.output<S>,
  ) => z.output<O> | Promise<z.output<O>>;
}): OperationDefinition<S, O> {
  return {
    mcpName: definition.mcpName,
    description: definition.description,
    input: definition.input,
    output: definition.output,
    run: async (ctx, input) => definition.run(ctx, input),
    execute: async (ctx, input) =>
      definition.run(ctx, definition.input.parse(input)),
  };
}

export const operationCatalog = {
  listsList: defineOperation({
    mcpName: "lists_list",
    description: "List mailing lists visible to the authenticated user.",
    input: emptyInput,
    output: z.array(listOutput),
    run: (ctx) => listLists(ctx),
  }),
  listStats: defineOperation({
    mcpName: "list_stats",
    description:
      "Count active subscriber memberships in an accessible list by confirmation status.",
    input: idInput,
    output: listStatsOutput,
    run: (ctx, input) => getListStats(ctx, input.id),
  }),
  subscribersList: defineOperation({
    mcpName: "subscribers_list",
    description: "List subscribers without exposing unsubscribe tokens.",
    input: subscriberListInput,
    output: z.array(subscriberSummaryOutput),
    run: (ctx, input) => listSubscribers(ctx, input),
  }),
  subscriberGet: defineOperation({
    mcpName: "subscriber_get",
    description: "Get a subscriber and visible list memberships.",
    input: idInput,
    output: subscriberOutput,
    run: (ctx, input) => getSubscriber(ctx, input.id),
  }),
  subscriberCreate: defineOperation({
    mcpName: "subscriber_create",
    description:
      "Create or resubscribe a subscriber to one or more lists. Memberships start unconfirmed; sendConfirmation=true emails requested unconfirmed memberships.",
    input: subscriberCreateInput,
    output: subscriberCreatedOutput,
    run: createSubscriberOperation,
  }),
  subscriberDelete: defineOperation({
    mcpName: "subscriber_delete",
    description:
      "Delete one subscriber and dependent records. Requires confirm=true.",
    input: subscriberDeleteInput,
    output: subscriberDeletedOutput,
    run: (ctx, input) => deleteSubscriber(ctx, input.id, input.confirm),
  }),
  subscriberUnsubscribe: defineOperation({
    mcpName: "subscriber_unsubscribe",
    description:
      "Unsubscribe a subscriber from one accessible list. Requires confirm=true.",
    input: subscriberUnsubscribeInput,
    output: subscriberUnsubscribedOutput,
    run: (ctx, input) =>
      unsubscribeSubscriber(ctx, input.id, input.listId, input.confirm),
  }),
  campaignsList: defineOperation({
    mcpName: "campaigns_list",
    description: "List visible campaigns.",
    input: paginationInput,
    output: z.array(campaignOutput),
    run: (ctx, input) => listCampaigns(ctx, input),
  }),
  campaignGet: defineOperation({
    mcpName: "campaign_get",
    description: "Get a campaign and its delivery counts.",
    input: idInput,
    output: campaignDetailOutput,
    run: (ctx, input) => getCampaign(ctx, input.id),
  }),
  campaignSends: defineOperation({
    mcpName: "campaign_sends",
    description:
      "List actual recipient send records for an accessible campaign.",
    input: campaignSendsInput,
    output: z.array(campaignSendOutput),
    run: (ctx, input) => listCampaignSends(ctx, input),
  }),
  campaignPreview: defineOperation({
    mcpName: "campaign_preview",
    description:
      "Render a campaign with sample subscriber data without sending mail.",
    input: idInput,
    output: campaignPreviewOutput,
    run: (ctx, input) => previewCampaign(ctx, input.id),
  }),
  campaignCreateDraft: defineOperation({
    mcpName: "campaign_create_draft",
    description: "Create a campaign draft. This never sends mail.",
    input: campaignCreateInput,
    output: campaignOutput,
    run: createCampaignDraft,
  }),
  campaignUpdateDraft: defineOperation({
    mcpName: "campaign_update_draft",
    description:
      "Replace a campaign draft's content and audience. This never sends mail.",
    input: campaignUpdateInput,
    output: campaignOutput,
    run: updateCampaignDraft,
  }),
  campaignSend: defineOperation({
    mcpName: "campaign_send",
    description: "Send a campaign. Requires confirm=true.",
    input: campaignSendInput,
    output: campaignDetailOutput,
    run: (ctx, input) => sendCampaignOperation(ctx, input.id, input.confirm),
  }),
  campaignTestSend: defineOperation({
    mcpName: "campaign_test_send",
    description:
      "Send a separate test copy to selected confirmed members of the campaign list. Requires confirm=true.",
    input: campaignTestSendInput,
    output: campaignDetailOutput,
    run: (ctx, input) =>
      sendCampaignTestOperation(
        ctx,
        input.id,
        input.subscriberIds,
        input.confirm,
      ),
  }),
  deliverabilitySummary: defineOperation({
    mcpName: "deliverability_summary",
    description: "Summarize delivery lifecycle states and provider events.",
    input: emptyInput,
    output: deliverabilityOutput,
    run: (ctx) => getDeliverabilitySummary(ctx),
  }),
  dmarcSummary: defineOperation({
    mcpName: "dmarc_summary",
    description: "Summarize DMARC reports for visible sending domains.",
    input: emptyInput,
    output: dmarcOutput,
    run: (ctx) => getDmarcSummary(ctx),
  }),
  templatesList: defineOperation({
    mcpName: "email_templates_list",
    description: "List email templates and their active state.",
    input: emptyInput,
    output: z.array(templateSummaryOutput),
    run: (ctx) => listTemplates(ctx),
  }),
  templateGet: defineOperation({
    mcpName: "email_template_get",
    description: "Get an email template, sections, partials, and source.",
    input: templateSlugInput,
    output: templateDetailOutput,
    run: (ctx, input) => getTemplate(ctx, input.slug),
  }),
  templateCreate: defineOperation({
    mcpName: "email_template_create",
    description: "Create and activate a validated email template.",
    input: templateCreateInput,
    output: templateDetailOutput,
    run: createTemplate,
  }),
  templateValidate: defineOperation({
    mcpName: "email_template_validate",
    description:
      "Validate and compile HTML, MJML, or text template source without persisting it.",
    input: templateSourceInput,
    output: templateValidationOutput,
    run: validateTemplateSource,
  }),
  templateUpdate: defineOperation({
    mcpName: "email_template_update",
    description: "Replace an email template with validated source.",
    input: templateUpdateInput,
    output: templateDetailOutput,
    run: updateTemplate,
  }),
  templatePreview: defineOperation({
    mcpName: "email_template_preview",
    description:
      "Render HTML and text for a stored template with sample or supplied section content.",
    input: templatePreviewInput,
    output: templatePreviewOutput,
    run: (ctx, input) => previewTemplate(ctx, input.slug, input.sectionSources),
  }),
  templateArchive: defineOperation({
    mcpName: "email_template_archive",
    description: "Archive a custom template. Requires confirm=true.",
    input: templateArchiveInput,
    output: templateSummaryOutput,
    run: (ctx, input) => archiveTemplate(ctx, input.slug, input.confirm),
  }),
  templateDuplicate: defineOperation({
    mcpName: "email_template_duplicate",
    description: "Duplicate a template.",
    input: templateDuplicateInput,
    output: templateDetailOutput,
    run: (ctx, input) =>
      duplicateTemplate(ctx, input.slug, input.newSlug, input.newName),
  }),
} as const;

export const mcpOperations = new Map(
  Object.values(operationCatalog).map((operation) => [
    operation.mcpName,
    operation,
  ]),
);

export const mcpTools = Object.values(operationCatalog).map((operation) => ({
  name: operation.mcpName,
  description: operation.description,
  inputSchema: z.toJSONSchema(operation.input, { target: "draft-7" }),
  outputSchema: z.toJSONSchema(operation.output, { target: "draft-7" }),
}));
