import { Elysia } from "elysia";
import { z } from "zod";
import { type Db } from "../db";
import type { Config } from "../config";
import { AccessDeniedError } from "../services/access";
import {
  InvalidOperationError,
  NotFoundError,
  type OperationContext,
} from "../operations";
import { operationCatalog } from "../operations/catalog";
import {
  apiErrorOutput,
  campaignDetailOutput,
  campaignCreateInput,
  campaignOutput,
  campaignSendOutput,
  campaignPreviewOutput,
  campaignSendInput,
  campaignTestSendInput,
  campaignUpdateInput,
  dataOutput,
  deliverabilityOutput,
  dmarcOutput,
  idInput,
  listOutput,
  listStatsOutput,
  paginationInput,
  subscriberCreateInput,
  subscriberCreatedOutput,
  subscriberDeletedOutput,
  subscriberListInput,
  subscriberOutput,
  subscriberSummaryOutput,
  subscriberUnsubscribeInput,
  subscriberUnsubscribedOutput,
  templateCreateInput,
  templateDetailOutput,
  templateDuplicateInput,
  templatePreviewInput,
  templatePreviewOutput,
  templateSlugInput,
  templateSummaryOutput,
  templateSourceInput,
  templateUpdateInput,
  templateValidationOutput,
} from "../operations/contracts";
import { bearerAuth } from "./api-auth";
import { TemplateValidationError } from "../services/email-templates";

const confirmationQuery = z.object({ confirm: z.literal("true") }).strict();
const errorResponses = {
  400: apiErrorOutput,
  401: apiErrorOutput,
  403: apiErrorOutput,
  404: apiErrorOutput,
  500: apiErrorOutput,
} as const;
const authenticatedRoute = { security: [{ bearerAuth: [] }] };

export function apiRoutes(db: Db, config: Config) {
  const context = (
    principal: OperationContext["principal"],
  ): OperationContext => ({ db, config, principal });

  return new Elysia({ name: "api-v1" })
    .use(bearerAuth(db, { config }))
    .onError(({ code, error, status }) => {
      if (code === "VALIDATION") return status(400, { error: error.message });
      if (error instanceof AccessDeniedError)
        return status(403, { error: error.message });
      if (error instanceof NotFoundError)
        return status(404, { error: error.message });
      if (error instanceof InvalidOperationError)
        return status(400, { error: error.message });
      if (error instanceof TemplateValidationError)
        return status(400, { error: error.message });
      console.error(error);
      return status(500, { error: "Internal server error" });
    })
    .guard({ authenticated: true }, (app) =>
      app
        .get(
          "/v1/lists",
          async ({ principal }) => ({
            data: await operationCatalog.listsList.run(context(principal), {}),
          }),
          {
            response: {
              200: dataOutput(z.array(listOutput)),
              ...errorResponses,
            },
            detail: {
              summary: "List mailing lists",
              tags: ["Lists"],
              ...authenticatedRoute,
            },
          },
        )
        .get(
          "/v1/lists/:id/stats",
          async ({ principal, params }) => ({
            data: await operationCatalog.listStats.run(
              context(principal),
              params,
            ),
          }),
          {
            params: idInput,
            response: { 200: dataOutput(listStatsOutput), ...errorResponses },
            detail: {
              summary: "Get subscriber counts for a list",
              tags: ["Lists"],
              ...authenticatedRoute,
            },
          },
        )
        .get(
          "/v1/subscribers",
          async ({ principal, query }) => ({
            data: await operationCatalog.subscribersList.run(
              context(principal),
              query,
            ),
          }),
          {
            query: subscriberListInput,
            response: {
              200: dataOutput(z.array(subscriberSummaryOutput)),
              ...errorResponses,
            },
            detail: {
              summary: "List subscribers",
              tags: ["Subscribers"],
              ...authenticatedRoute,
            },
          },
        )
        .get(
          "/v1/subscribers/:id",
          async ({ principal, params }) => ({
            data: await operationCatalog.subscriberGet.run(
              context(principal),
              params,
            ),
          }),
          {
            params: idInput,
            response: { 200: dataOutput(subscriberOutput), ...errorResponses },
            detail: {
              summary: "Get a subscriber",
              tags: ["Subscribers"],
              ...authenticatedRoute,
            },
          },
        )
        .post(
          "/v1/subscribers",
          async ({ principal, body, status }) =>
            status(201, {
              data: await operationCatalog.subscriberCreate.run(
                context(principal),
                body,
              ),
            }),
          {
            body: subscriberCreateInput,
            response: {
              201: dataOutput(subscriberCreatedOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Create or resubscribe a subscriber",
              tags: ["Subscribers"],
              ...authenticatedRoute,
            },
          },
        )
        .delete(
          "/v1/subscribers/:id",
          async ({ principal, params }) => ({
            data: await operationCatalog.subscriberDelete.run(
              context(principal),
              {
                id: params.id,
                confirm: true,
              },
            ),
          }),
          {
            params: idInput,
            query: confirmationQuery,
            response: {
              200: dataOutput(subscriberDeletedOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Delete a subscriber",
              tags: ["Subscribers"],
              ...authenticatedRoute,
            },
          },
        )
        .post(
          "/v1/subscribers/:id/unsubscribe",
          async ({ principal, params, body }) => ({
            data: await operationCatalog.subscriberUnsubscribe.run(
              context(principal),
              {
                id: params.id,
                ...body,
              },
            ),
          }),
          {
            params: idInput,
            body: subscriberUnsubscribeInput.omit({ id: true }),
            response: {
              200: dataOutput(subscriberUnsubscribedOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Unsubscribe from one list",
              tags: ["Subscribers"],
              ...authenticatedRoute,
            },
          },
        )
        .get(
          "/v1/campaigns",
          async ({ principal, query }) => ({
            data: await operationCatalog.campaignsList.run(
              context(principal),
              query,
            ),
          }),
          {
            query: paginationInput,
            response: {
              200: dataOutput(z.array(campaignOutput)),
              ...errorResponses,
            },
            detail: {
              summary: "List campaigns",
              tags: ["Campaigns"],
              ...authenticatedRoute,
            },
          },
        )
        .get(
          "/v1/campaigns/:id",
          async ({ principal, params }) => ({
            data: await operationCatalog.campaignGet.run(
              context(principal),
              params,
            ),
          }),
          {
            params: idInput,
            response: {
              200: dataOutput(campaignDetailOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Get a campaign",
              tags: ["Campaigns"],
              ...authenticatedRoute,
            },
          },
        )
        .get(
          "/v1/campaigns/:id/sends",
          async ({ principal, params, query }) => ({
            data: await operationCatalog.campaignSends.run(context(principal), {
              id: params.id,
              ...query,
            }),
          }),
          {
            params: idInput,
            query: paginationInput,
            response: {
              200: dataOutput(z.array(campaignSendOutput)),
              ...errorResponses,
            },
            detail: {
              summary: "List campaign send records",
              tags: ["Campaigns"],
              ...authenticatedRoute,
            },
          },
        )
        .get(
          "/v1/campaigns/:id/preview",
          async ({ principal, params }) => ({
            data: await operationCatalog.campaignPreview.run(
              context(principal),
              params,
            ),
          }),
          {
            params: idInput,
            response: {
              200: dataOutput(campaignPreviewOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Preview a campaign",
              tags: ["Campaigns"],
              ...authenticatedRoute,
            },
          },
        )
        .post(
          "/v1/campaigns",
          async ({ principal, body, status }) =>
            status(201, {
              data: await operationCatalog.campaignCreateDraft.run(
                context(principal),
                body,
              ),
            }),
          {
            body: campaignCreateInput,
            response: { 201: dataOutput(campaignOutput), ...errorResponses },
            detail: {
              summary: "Create a campaign draft",
              tags: ["Campaigns"],
              ...authenticatedRoute,
            },
          },
        )
        .put(
          "/v1/campaigns/:id",
          async ({ principal, params, body }) => ({
            data: await operationCatalog.campaignUpdateDraft.run(
              context(principal),
              {
                id: params.id,
                campaign: body,
              },
            ),
          }),
          {
            params: idInput,
            body: campaignUpdateInput.shape.campaign,
            response: { 200: dataOutput(campaignOutput), ...errorResponses },
            detail: {
              summary: "Replace a campaign draft",
              tags: ["Campaigns"],
              ...authenticatedRoute,
            },
          },
        )
        .post(
          "/v1/campaigns/:id/send",
          async ({ principal, params }) => ({
            data: await operationCatalog.campaignSend.run(context(principal), {
              id: params.id,
              confirm: true,
            }),
          }),
          {
            params: idInput,
            body: campaignSendInput.pick({ confirm: true }),
            response: {
              200: dataOutput(campaignDetailOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Send a campaign",
              tags: ["Campaigns"],
              ...authenticatedRoute,
            },
          },
        )
        .post(
          "/v1/campaigns/:id/test-send",
          async ({ principal, params, body }) => ({
            data: await operationCatalog.campaignTestSend.run(
              context(principal),
              {
                id: params.id,
                ...body,
              },
            ),
          }),
          {
            params: idInput,
            body: campaignTestSendInput.omit({ id: true }),
            response: {
              200: dataOutput(campaignDetailOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Send a limited campaign test",
              tags: ["Campaigns"],
              ...authenticatedRoute,
            },
          },
        )
        .get(
          "/v1/deliverability",
          async ({ principal }) => ({
            data: await operationCatalog.deliverabilitySummary.run(
              context(principal),
              {},
            ),
          }),
          {
            response: {
              200: dataOutput(deliverabilityOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Get a deliverability summary",
              tags: ["Deliverability"],
              ...authenticatedRoute,
            },
          },
        )
        .get(
          "/v1/dmarc",
          async ({ principal }) => ({
            data: await operationCatalog.dmarcSummary.run(
              context(principal),
              {},
            ),
          }),
          {
            response: { 200: dataOutput(dmarcOutput), ...errorResponses },
            detail: {
              summary: "Get a DMARC summary",
              tags: ["Deliverability"],
              ...authenticatedRoute,
            },
          },
        )
        .get(
          "/v1/email-templates",
          async ({ principal }) => ({
            data: await operationCatalog.templatesList.run(
              context(principal),
              {},
            ),
          }),
          {
            response: {
              200: dataOutput(z.array(templateSummaryOutput)),
              ...errorResponses,
            },
            detail: {
              summary: "List email templates",
              tags: ["Email Templates"],
              ...authenticatedRoute,
            },
          },
        )
        .get(
          "/v1/email-templates/:slug",
          async ({ principal, params }) => ({
            data: await operationCatalog.templateGet.run(
              context(principal),
              params,
            ),
          }),
          {
            params: templateSlugInput,
            response: {
              200: dataOutput(templateDetailOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Get an email template",
              tags: ["Email Templates"],
              ...authenticatedRoute,
            },
          },
        )
        .post(
          "/v1/email-templates",
          async ({ principal, body, status }) =>
            status(201, {
              data: await operationCatalog.templateCreate.run(
                context(principal),
                body,
              ),
            }),
          {
            body: templateCreateInput,
            response: {
              201: dataOutput(templateDetailOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Create an email template",
              tags: ["Email Templates"],
              ...authenticatedRoute,
            },
          },
        )
        .post(
          "/v1/email-templates/validate",
          async ({ principal, body }) => ({
            data: await operationCatalog.templateValidate.run(
              context(principal),
              body,
            ),
          }),
          {
            body: templateSourceInput,
            response: {
              200: dataOutput(templateValidationOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Validate email template source",
              tags: ["Email Templates"],
              ...authenticatedRoute,
            },
          },
        )
        .put(
          "/v1/email-templates/:slug",
          async ({ principal, params, body }) => ({
            data: await operationCatalog.templateUpdate.run(
              context(principal),
              { ...body, slug: params.slug },
            ),
          }),
          {
            params: templateSlugInput,
            body: templateUpdateInput.omit({ slug: true }),
            response: {
              200: dataOutput(templateDetailOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Replace an email template",
              tags: ["Email Templates"],
              ...authenticatedRoute,
            },
          },
        )
        .post(
          "/v1/email-templates/:slug/preview",
          async ({ principal, params, body }) => ({
            data: await operationCatalog.templatePreview.run(
              context(principal),
              { ...body, slug: params.slug },
            ),
          }),
          {
            params: templateSlugInput,
            body: templatePreviewInput.omit({ slug: true }),
            response: {
              200: dataOutput(templatePreviewOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Preview an email template",
              tags: ["Email Templates"],
              ...authenticatedRoute,
            },
          },
        )
        .post(
          "/v1/email-templates/:slug/duplicate",
          async ({ principal, params, body, status }) =>
            status(201, {
              data: await operationCatalog.templateDuplicate.run(
                context(principal),
                { ...body, slug: params.slug },
              ),
            }),
          {
            params: templateSlugInput,
            body: templateDuplicateInput.omit({ slug: true }),
            response: {
              201: dataOutput(templateDetailOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Duplicate an email template",
              tags: ["Email Templates"],
              ...authenticatedRoute,
            },
          },
        )
        .delete(
          "/v1/email-templates/:slug",
          async ({ principal, params }) => ({
            data: await operationCatalog.templateArchive.run(
              context(principal),
              { slug: params.slug, confirm: true },
            ),
          }),
          {
            params: templateSlugInput,
            query: confirmationQuery,
            response: {
              200: dataOutput(templateSummaryOutput),
              ...errorResponses,
            },
            detail: {
              summary: "Archive an email template",
              tags: ["Email Templates"],
              ...authenticatedRoute,
            },
          },
        ),
    );
}
