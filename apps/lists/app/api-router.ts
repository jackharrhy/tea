import { IdentityError } from "@tea/identity";
import { createRouter } from "remix/router";
import { z } from "zod";

import type { Config } from "../src/config.ts";
import type { Db } from "../src/db/index.ts";
import {
  InvalidOperationError,
  NotFoundError,
  type OperationContext,
} from "../src/operations/index.ts";
import { operationCatalog } from "../src/operations/catalog.ts";
import { AccessDeniedError } from "../src/services/access.ts";
import { TemplateValidationError } from "../src/services/email-templates.ts";
import {
  authenticateBearer,
  createCentralBearerAuth,
} from "../src/services/request-auth.ts";

type Operation = keyof typeof operationCatalog;
type Params = Record<string, string | undefined>;
type Input = (request: Request, params: Params) => Promise<unknown> | unknown;
type Method = "GET" | "POST" | "PUT" | "DELETE";

function query(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams);
}

async function body(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new z.ZodError([
      { code: "custom", path: [], message: "Invalid JSON body" },
    ]);
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function confirmation(request: Request) {
  if (new URL(request.url).searchParams.get("confirm") !== "true")
    throw new z.ZodError([
      { code: "custom", path: ["confirm"], message: "confirm must be true" },
    ]);
}

function errorResponse(error: unknown) {
  const status =
    error instanceof IdentityError
      ? error.status
      : error instanceof AccessDeniedError
        ? 403
        : error instanceof NotFoundError
          ? 404
          : error instanceof z.ZodError ||
              error instanceof InvalidOperationError ||
              error instanceof TemplateValidationError
            ? 400
            : 500;
  if (status === 500) console.error(error);
  return Response.json(
    {
      error:
        status === 500
          ? "Internal server error"
          : error instanceof Error
            ? error.message
            : "Unauthorized",
    },
    { status },
  );
}

export function createApiRouter(db: Db, config: Config) {
  const router = createRouter();
  const central = config.identity ? createCentralBearerAuth(db, config) : null;
  const paths: Record<string, Record<string, unknown>> = {};

  async function run(
    operation: Operation,
    request: Request,
    params: Params,
    input: Input,
    status = 200,
  ) {
    try {
      const principal = central
        ? await central(request)
        : authenticateBearer(db, request);
      if (!principal)
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      const context: OperationContext = { db, config, principal };
      const value = await operationCatalog[operation].execute(
        context,
        await input(request, params),
      );
      return Response.json({ data: value }, { status });
    } catch (error) {
      return errorResponse(error);
    }
  }

  function register(
    method: Method,
    path: string,
    operation: Operation,
    input: Input,
    status = 200,
  ) {
    const handler = (context: { request: Request; params: Params }) =>
      run(operation, context.request, context.params, input, status);
    if (method === "GET") router.get(path, handler);
    else if (method === "POST") router.post(path, handler);
    else if (method === "PUT") router.put(path, handler);
    else router.delete(path, handler);
    const documentedPath = path.replace(/:([A-Za-z]+)/g, "{$1}");
    const entry = (paths[documentedPath] ??= {});
    const definition = operationCatalog[operation];
    const requestBody =
      method === "POST" || method === "PUT"
        ? {
            required: true,
            content: {
              "application/json": { schema: z.toJSONSchema(definition.input) },
            },
          }
        : undefined;
    entry[method.toLowerCase()] = {
      operationId: operation,
      security: [{ bearerAuth: [] }],
      ...(requestBody ? { requestBody } : {}),
      responses: {
        [status]: {
          description: "Success",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: { data: z.toJSONSchema(definition.output) },
              },
            },
          },
        },
      },
    };
  }

  const empty: Input = () => ({});
  const params: Input = (_, value) => value;
  const search: Input = (request) => query(request);
  const payload: Input = (request) => body(request);
  register("GET", "/api/v1/lists", "listsList", empty);
  register("GET", "/api/v1/lists/:id/stats", "listStats", params);
  register("GET", "/api/v1/subscribers", "subscribersList", search);
  register("GET", "/api/v1/subscribers/:id", "subscriberGet", params);
  register("POST", "/api/v1/subscribers", "subscriberCreate", payload, 201);
  register(
    "DELETE",
    "/api/v1/subscribers/:id",
    "subscriberDelete",
    (request, value) => {
      confirmation(request);
      return { id: value.id, confirm: true };
    },
  );
  register(
    "POST",
    "/api/v1/subscribers/:id/unsubscribe",
    "subscriberUnsubscribe",
    async (request, value) => ({
      id: value.id,
      ...object(await body(request)),
    }),
  );
  register("GET", "/api/v1/campaigns", "campaignsList", search);
  register("GET", "/api/v1/campaigns/:id", "campaignGet", params);
  register(
    "GET",
    "/api/v1/campaigns/:id/sends",
    "campaignSends",
    (request, value) => ({
      ...query(request),
      id: value.id,
    }),
  );
  register("GET", "/api/v1/campaigns/:id/preview", "campaignPreview", params);
  register("POST", "/api/v1/campaigns", "campaignCreateDraft", payload, 201);
  register(
    "PUT",
    "/api/v1/campaigns/:id",
    "campaignUpdateDraft",
    async (request, value) => ({
      id: value.id,
      campaign: await body(request),
    }),
  );
  register(
    "POST",
    "/api/v1/campaigns/:id/send",
    "campaignSend",
    async (request, value) => {
      const sent = await body(request);
      return { id: value.id, ...object(sent) };
    },
  );
  register(
    "POST",
    "/api/v1/campaigns/:id/test-send",
    "campaignTestSend",
    async (request, value) => ({
      id: value.id,
      ...object(await body(request)),
    }),
  );
  register("GET", "/api/v1/deliverability", "deliverabilitySummary", empty);
  register("GET", "/api/v1/dmarc", "dmarcSummary", empty);
  register("GET", "/api/v1/email-templates", "templatesList", empty);
  register("GET", "/api/v1/email-templates/:slug", "templateGet", params);
  register("POST", "/api/v1/email-templates", "templateCreate", payload, 201);
  register(
    "POST",
    "/api/v1/email-templates/validate",
    "templateValidate",
    payload,
  );
  register(
    "PUT",
    "/api/v1/email-templates/:slug",
    "templateUpdate",
    async (request, value) => ({
      ...object(await body(request)),
      slug: value.slug,
    }),
  );
  register(
    "POST",
    "/api/v1/email-templates/:slug/preview",
    "templatePreview",
    async (request, value) => ({
      ...object(await body(request)),
      slug: value.slug,
    }),
  );
  register(
    "POST",
    "/api/v1/email-templates/:slug/duplicate",
    "templateDuplicate",
    async (request, value) => ({
      ...object(await body(request)),
      slug: value.slug,
    }),
    201,
  );
  register(
    "DELETE",
    "/api/v1/email-templates/:slug",
    "templateArchive",
    (request, value) => {
      confirmation(request);
      return { slug: value.slug, confirm: true };
    },
  );
  router.get("/openapi/json", () =>
    Response.json({
      openapi: "3.1.0",
      info: {
        title: "lists API",
        version: "1.0.0",
        description:
          "Scoped API for managing mailing lists, subscribers, campaigns, and deliverability.",
      },
      paths,
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      },
    }),
  );
  return router;
}
