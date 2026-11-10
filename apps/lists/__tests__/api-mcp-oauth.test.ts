import { beforeEach, describe, expect, test } from "bun:test";
import { mockClient } from "aws-sdk-client-mock";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { eq } from "drizzle-orm";
import { createHttpApp } from "../src/http";
import { apiRoutes } from "../src/routes/api";
import { mcpRoutes } from "../src/routes/mcp";
import { oauthRoutes } from "../src/routes/oauth";
import { createSession } from "../src/auth";
import { mintApiToken as mintScopedToken } from "../src/services/api-tokens";
import { createSubscriber } from "../src/services/subscriber";
import { operationCatalog } from "../src/operations/catalog";
import { apiOpenApi } from "../src/openapi";
import { createTestDb, seedList } from "./helpers";
import * as schema from "../src/db/schema";
import type { Config } from "../src/config";

const sesMock = mockClient(SESv2Client);
beforeEach(() => sesMock.reset());

const config: Config = {
  awsRegion: "us-east-1",
  sqsQueueUrl: "queue",
  s3Bucket: "bucket",
  dbPath: ":memory:",
  fromDomain: "example.com",
  baseUrl: "http://localhost",
  sesConfigSet: "config",
  s3MediaBucket: "",
  s3MediaBaseUrl: "",
  ownerEmail: "",
  ownerPassword: "",
  oauthDynamicRegistrationEnabled: true,
};

function mintApiToken(
  db: ReturnType<typeof createTestDb>,
  userId: number,
  name: string,
  scopes: Parameters<typeof mintScopedToken>[3],
  expiresAt: string | null = null,
) {
  return mintScopedToken(
    db,
    userId,
    name,
    scopes,
    expiresAt,
    "http://localhost/mcp",
  );
}

function setup() {
  const db = createTestDb();
  const user = db
    .insert(schema.users)
    .values({ email: "owner@example.com", passwordHash: "hash", role: "owner" })
    .returning()
    .get();
  seedList(db, { slug: "news", name: "News" });
  const app = createHttpApp();
  app.use(apiOpenApi());
  app.use(oauthRoutes(db, config));
  app.group("/api", (group) => group.use(apiRoutes(db, config)));
  app.group("/mcp", (group) => group.use(mcpRoutes(db, config)));
  return { app, db, user };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function mcpCall(
  app: ReturnType<typeof createHttpApp>,
  token: string,
  name: string,
  args: unknown,
) {
  const response = await app.request("/mcp/", {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return response.json() as Promise<any>;
}

describe("scoped API and MCP", () => {
  test("advertises OAuth metadata for an unauthenticated MCP GET probe", async () => {
    const { app } = setup();
    const response = await app.request("/mcp/");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource"',
    );
  });

  test("only exposes the versioned REST contract", async () => {
    const { app, db, user } = setup();
    const { token } = mintApiToken(db, user.id, "reader", ["subscribers:read"]);
    expect(
      (await app.request("/api/subscribers", { headers: bearer(token) }))
        .status,
    ).toBe(404);
    expect(
      (await app.request("/api/v1/subscribers", { headers: bearer(token) }))
        .status,
    ).toBe(200);
  });

  test("publishes the typed REST contract as OpenAPI", async () => {
    const { app } = setup();
    const response = await app.request("/openapi/json");
    expect(response.status).toBe(200);
    const document = (await response.json()) as any;
    const createSubscriberOperation =
      document.paths["/api/v1/subscribers"].post;
    expect(createSubscriberOperation.security).toEqual([{ bearerAuth: [] }]);
    expect(
      createSubscriberOperation.requestBody.content["application/json"].schema
        .required,
    ).toEqual(["email", "lists"]);
    expect(
      createSubscriberOperation.responses[201].content["application/json"]
        .schema.properties.data,
    ).toBeDefined();
    expect(document.components.securitySchemes.bearerAuth.scheme).toBe(
      "bearer",
    );
  });

  test("REST and MCP call the same list operation with the same token", async () => {
    const { app, db, user } = setup();
    const { token } = mintApiToken(db, user.id, "agent", ["lists:read"]);

    const rest = await app.request("/api/v1/lists", { headers: bearer(token) });
    expect(rest.status).toBe(200);
    const restData = ((await rest.json()) as any).data;

    const mcp = await app.request("/mcp/", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "lists_list", arguments: {} },
      }),
    });
    expect(mcp.status).toBe(200);
    const mcpData = (await mcp.json()) as any;
    expect(mcpData.result.structuredContent).toEqual(restData);

    const forbidden = await app.request("/api/v1/subscribers", {
      headers: bearer(token),
    });
    expect(forbidden.status).toBe(403);
    expect(db.select().from(schema.apiTokens).get()!.tokenHash).not.toContain(
      token,
    );
  });

  test("campaign send records expose recipient emails only within the member's list", async () => {
    const { app, db } = setup();
    const list = db
      .select()
      .from(schema.lists)
      .where(eq(schema.lists.slug, "news"))
      .get()!;
    const other = seedList(db, { slug: "other", name: "Other" });
    const member = db
      .insert(schema.users)
      .values({
        email: "member@example.com",
        passwordHash: "hash",
        role: "member",
      })
      .returning()
      .get();
    db.insert(schema.userLists)
      .values({ userId: member.id, listId: list.id })
      .run();
    const { token } = mintApiToken(db, member.id, "campaign reader", [
      "campaigns:read",
    ]);
    const recipient = createSubscriber(db, "pilot@example.com", null, null, [
      list.slug,
    ]);
    const visible = db
      .insert(schema.campaigns)
      .values({
        subject: "Pilot",
        bodyMarkdown: "Body",
        fromAddress: "news@example.com",
        audienceType: "list",
        audienceId: list.id,
      })
      .returning()
      .get();
    const hidden = db
      .insert(schema.campaigns)
      .values({
        subject: "Other",
        bodyMarkdown: "Body",
        fromAddress: "news@example.com",
        audienceType: "list",
        audienceId: other.id,
      })
      .returning()
      .get();
    db.insert(schema.campaignSends)
      .values({
        campaignId: visible.id,
        subscriberId: recipient.id,
        status: "delivered",
      })
      .run();

    const path = `/api/v1/campaigns/${visible.id}/sends`;
    const rest = await app.request(path, { headers: bearer(token) });
    expect(rest.status).toBe(200);
    expect(((await rest.json()) as any).data).toMatchObject([
      { email: "pilot@example.com", status: "delivered" },
    ]);
    const mcp = await mcpCall(app, token, "campaign_sends", { id: visible.id });
    expect(mcp.result.structuredContent).toMatchObject([
      { email: "pilot@example.com", status: "delivered" },
    ]);
    expect(
      (
        await app.request(`${path}?limit=1&offset=1`, {
          headers: bearer(token),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/campaigns/${hidden.id}/sends`, {
          headers: bearer(token),
        })
      ).status,
    ).toBe(403);
  });

  test("advertises every canonical operation as an MCP tool", async () => {
    const { app, db, user } = setup();
    const { token } = mintApiToken(db, user.id, "agent", ["lists:read"]);
    const response = await app.request("/mcp/", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    const body = (await response.json()) as any;
    expect(
      body.result.tools
        .map((tool: any) => tool.name)
        .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual(
      Object.values(operationCatalog)
        .map((operation) => operation.mcpName)
        .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    const create = body.result.tools.find(
      (tool: any) => tool.name === "subscriber_create",
    );
    expect(create.inputSchema.required).toEqual(["email", "lists"]);
    expect(create.inputSchema.properties.email.format).toBe("email");
    expect(
      body.result.tools.some(
        (tool: any) => tool.name === "email_template_activate",
      ),
    ).toBe(false);
    expect(create.outputSchema.required).toEqual(["id", "email"]);
  });

  test("uses Elysia validation for malformed JSON-RPC requests", async () => {
    const { app, db, user } = setup();
    const { token } = mintApiToken(db, user.id, "agent", ["lists:read"]);
    const response = await app.request("/mcp/", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "1.0", method: "tools/list" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  test("creates subscribers through the same contract in REST and MCP", async () => {
    const { app, db, user } = setup();
    const { token } = mintApiToken(db, user.id, "writer", [
      "subscribers:write",
    ]);
    const rest = await app.request("/api/v1/subscribers", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "rest@example.com",
        firstName: "Rest",
        lists: ["news"],
      }),
    });
    expect(rest.status).toBe(201);
    expect(((await rest.json()) as any).data.email).toBe("rest@example.com");

    const mcp = await mcpCall(app, token, "subscriber_create", {
      email: "mcp@example.com",
      firstName: "MCP",
      lists: ["news"],
    });
    expect(mcp.result.isError).toBeUndefined();
    expect(mcp.result.structuredContent.email).toBe("mcp@example.com");
    expect(
      db
        .select()
        .from(schema.subscriberLists)
        .all()
        .map((row) => row.status),
    ).toEqual(["unconfirmed", "unconfirmed"]);
  });

  test("optionally sends confirmation for unconfirmed memberships but not confirmed ones", async () => {
    const { app, db, user } = setup();
    db.update(schema.lists).set({ fromAddress: "news@example.com" }).run();
    const { token } = mintApiToken(db, user.id, "writer", [
      "subscribers:write",
    ]);
    sesMock.on(SendEmailCommand).resolves({ MessageId: "confirmation" });
    const input = {
      email: "signup@example.com",
      lists: ["news"],
      sendConfirmation: true,
    };

    const first = await app.request("/api/v1/subscribers", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(first.status).toBe(201);
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
    expect(
      sesMock.commandCalls(SendEmailCommand)[0]!.args[0].input.FromEmailAddress,
    ).toBe('"News" <news@example.com>');

    const repeated = await mcpCall(app, token, "subscriber_create", input);
    expect(repeated.result.isError).toBeUndefined();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2);

    const subscriber = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.email, input.email))
      .get()!;
    db.update(schema.subscriberLists)
      .set({ status: "confirmed" })
      .where(eq(schema.subscriberLists.subscriberId, subscriber.id))
      .run();
    const confirmed = await mcpCall(app, token, "subscriber_create", input);
    expect(confirmed.result.isError).toBeUndefined();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2);

    db.update(schema.subscriberLists)
      .set({ status: "unsubscribed" })
      .where(eq(schema.subscriberLists.subscriberId, subscriber.id))
      .run();
    const resubscribed = await mcpCall(app, token, "subscriber_create", input);
    expect(resubscribed.result.isError).toBeUndefined();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(3);
    expect(db.select().from(schema.subscriberLists).get()?.status).toBe(
      "unconfirmed",
    );
  });

  test("propagates confirmation provider errors and leaves membership unconfirmed", async () => {
    const { app, db, user } = setup();
    const { token } = mintApiToken(db, user.id, "writer", [
      "subscribers:write",
    ]);
    sesMock.on(SendEmailCommand).rejects(new Error("SES unavailable"));
    const response = await app.request("/api/v1/subscribers", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "failed@example.com",
        lists: ["news"],
        sendConfirmation: true,
      }),
    });
    expect(response.status).toBe(500);
    expect(db.select().from(schema.subscriberLists).get()?.status).toBe(
      "unconfirmed",
    );

    sesMock.reset();
    sesMock.on(SendEmailCommand).resolves({ MessageId: "retry" });
    const retry = await app.request("/api/v1/subscribers", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "failed@example.com",
        lists: ["news"],
        sendConfirmation: true,
      }),
    });
    expect(retry.status).toBe(201);
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
  });

  test("rejects invalid subscriber input consistently without writing data", async () => {
    const { app, db, user } = setup();
    const { token } = mintApiToken(db, user.id, "writer", [
      "subscribers:write",
    ]);
    const input = { email: "not-an-email", lists: ["news"] };
    const rest = await app.request("/api/v1/subscribers", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(rest.status).toBe(400);
    const mcp = await mcpCall(app, token, "subscriber_create", input);
    expect(mcp.result.isError).toBe(true);
    expect(db.select().from(schema.subscribers).all()).toEqual([]);
  });

  test("filters subscribers by accessible list and unsubscribes only that membership", async () => {
    const { app, db } = setup();
    const news = db
      .select()
      .from(schema.lists)
      .where(eq(schema.lists.slug, "news"))
      .get()!;
    const other = seedList(db, { slug: "other", name: "Other" });
    const subscriber = createSubscriber(
      db,
      "reader@example.com",
      "Reader",
      null,
      ["news", "other"],
    );
    db.update(schema.subscriberLists)
      .set({ status: "confirmed" })
      .where(eq(schema.subscriberLists.subscriberId, subscriber.id))
      .run();
    const member = db
      .insert(schema.users)
      .values({
        email: "member@example.com",
        passwordHash: "hash",
        role: "member",
      })
      .returning()
      .get();
    db.insert(schema.userLists)
      .values({ userId: member.id, listId: news.id })
      .run();
    const { token } = mintApiToken(db, member.id, "member", [
      "lists:read",
      "subscribers:read",
      "subscribers:write",
    ]);

    const listed = await app.request(
      `/api/v1/subscribers?listId=${news.id}&membershipStatus=confirmed&search=reader`,
      {
        headers: bearer(token),
      },
    );
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as any).data[0].membershipStatus).toBe(
      "confirmed",
    );
    const stats = await app.request(`/api/v1/lists/${news.id}/stats`, {
      headers: bearer(token),
    });
    expect(((await stats.json()) as any).data.confirmed).toBe(1);
    expect(
      (
        await app.request(`/api/v1/lists/${other.id}/stats`, {
          headers: bearer(token),
        })
      ).status,
    ).toBe(403);

    const unsubscribe = await mcpCall(app, token, "subscriber_unsubscribe", {
      id: subscriber.id,
      listId: news.id,
      confirm: true,
    });
    expect(unsubscribe.result.structuredContent.status).toBe("unsubscribed");
    expect(
      db
        .select()
        .from(schema.subscriberLists)
        .where(eq(schema.subscriberLists.listId, other.id))
        .get()?.status,
    ).toBe("confirmed");
    expect(
      db
        .select()
        .from(schema.subscriberLists)
        .where(eq(schema.subscriberLists.listId, news.id))
        .get()?.status,
    ).toBe("unsubscribed");
  });

  test("enforces member list access for subscriber creation in both transports", async () => {
    const { app, db } = setup();
    const hidden = seedList(db, { slug: "hidden", name: "Hidden" });
    const member = db
      .insert(schema.users)
      .values({
        email: "member@example.com",
        passwordHash: "hash",
        role: "member",
      })
      .returning()
      .get();
    const visible = db
      .select()
      .from(schema.lists)
      .where(eq(schema.lists.slug, "news"))
      .get()!;
    db.insert(schema.userLists)
      .values({ userId: member.id, listId: visible.id })
      .run();
    const { token } = mintApiToken(db, member.id, "member writer", [
      "subscribers:write",
    ]);
    const input = { email: "blocked@example.com", lists: [hidden.slug] };

    const rest = await app.request("/api/v1/subscribers", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(rest.status).toBe(403);
    const mcp = await mcpCall(app, token, "subscriber_create", input);
    expect(mcp.result.isError).toBe(true);
    expect(db.select().from(schema.subscribers).all()).toEqual([]);
  });

  test("rejects malformed campaign audiences consistently without writing data", async () => {
    const { app, db, user } = setup();
    const { token } = mintApiToken(db, user.id, "campaign writer", [
      "campaigns:write",
    ]);
    const input = {
      subject: "Bad audience",
      bodyMarkdown: "Body",
      fromAddress: "sender@example.com",
      audienceType: "subscribers",
      audienceData: { ids: [1, 2] },
    };
    const rest = await app.request("/api/v1/campaigns", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(rest.status).toBe(400);
    const mcp = await mcpCall(app, token, "campaign_create_draft", input);
    expect(mcp.result.isError).toBe(true);
    expect(db.select().from(schema.campaigns).all()).toEqual([]);
  });

  test("replaces only accessible drafts through REST and MCP without sending", async () => {
    const { app, db, user } = setup();
    const list = db
      .select()
      .from(schema.lists)
      .where(eq(schema.lists.slug, "news"))
      .get()!;
    const { token } = mintApiToken(db, user.id, "writer", ["campaigns:write"]);
    const draft = {
      subject: "Initial",
      bodyMarkdown: "Initial body",
      fromAddress: "news@example.com",
      audienceType: "list" as const,
      audienceId: list.id,
    };
    const created = await app.request("/api/v1/campaigns", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as any).data.id;
    const changed = {
      ...draft,
      subject: "Revised",
      bodyMarkdown: "Revised body",
    };
    const rest = await app.request(`/api/v1/campaigns/${id}`, {
      method: "PUT",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify(changed),
    });
    expect(rest.status).toBe(200);
    expect(((await rest.json()) as any).data.subject).toBe("Revised");
    const mcp = await mcpCall(app, token, "campaign_update_draft", {
      id,
      campaign: { ...changed, subject: "Final" },
    });
    expect(mcp.result.structuredContent.subject).toBe("Final");
    expect(
      db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, id))
        .get()?.subject,
    ).toBe("Final");
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);

    db.update(schema.campaigns)
      .set({ status: "sent" })
      .where(eq(schema.campaigns.id, id))
      .run();
    const sent = await app.request(`/api/v1/campaigns/${id}`, {
      method: "PUT",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify(changed),
    });
    expect(sent.status).toBe(400);
    expect(
      db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, id))
        .get()?.subject,
    ).toBe("Final");
  });

  test("previews a draft and sends a test copy only to selected confirmed list members", async () => {
    const { app, db } = setup();
    const list = db
      .select()
      .from(schema.lists)
      .where(eq(schema.lists.slug, "news"))
      .get()!;
    const selected = createSubscriber(db, "selected@example.com", null, null, [
      "news",
    ]);
    const unselected = createSubscriber(db, "other@example.com", null, null, [
      "news",
    ]);
    db.update(schema.subscriberLists).set({ status: "confirmed" }).run();
    const member = db
      .insert(schema.users)
      .values({
        email: "member@example.com",
        passwordHash: "hash",
        role: "member",
      })
      .returning()
      .get();
    db.insert(schema.userLists)
      .values({ userId: member.id, listId: list.id })
      .run();
    const { token } = mintApiToken(db, member.id, "member sender", [
      "campaigns:read",
      "campaigns:write",
      "campaigns:send",
    ]);
    sesMock.on(SendEmailCommand).resolves({ MessageId: "test-send" });
    const created = await app.request("/api/v1/campaigns", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Harbour update",
        bodyMarkdown: "A local update.",
        fromAddress: "news@example.com",
        audienceType: "list",
        audienceId: list.id,
      }),
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as any).data.id;
    const preview = await app.request(`/api/v1/campaigns/${id}/preview`, {
      headers: bearer(token),
    });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as any).data.text).toContain(
      "A local update.",
    );

    const sent = await app.request(`/api/v1/campaigns/${id}/test-send`, {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({ subscriberIds: [selected.id], confirm: true }),
    });
    expect(sent.status).toBe(200);
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
    expect(
      sesMock.commandCalls(SendEmailCommand)[0]!.args[0].input.Destination
        ?.ToAddresses,
    ).toEqual([selected.email]);
    expect(
      db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, id))
        .get()?.status,
    ).toBe("draft");

    db.update(schema.subscriberLists)
      .set({ status: "unsubscribed" })
      .where(eq(schema.subscriberLists.subscriberId, unselected.id))
      .run();
    const rejected = await mcpCall(app, token, "campaign_test_send", {
      id,
      subscriberIds: [unselected.id],
      confirm: true,
    });
    expect(rejected.result.isError).toBe(true);
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
  });

  test("rejects draft updates without write scope or access to either audience", async () => {
    const { app, db, user } = setup();
    const news = db
      .select()
      .from(schema.lists)
      .where(eq(schema.lists.slug, "news"))
      .get()!;
    const hidden = seedList(db, { slug: "hidden", name: "Hidden" });
    const campaign = db
      .insert(schema.campaigns)
      .values({
        subject: "Protected",
        bodyMarkdown: "Body",
        fromAddress: "news@example.com",
        audienceType: "list",
        audienceId: news.id,
      })
      .returning()
      .get();
    const input = {
      subject: "Changed",
      bodyMarkdown: "Body",
      fromAddress: "news@example.com",
      audienceType: "list",
      audienceId: hidden.id,
    };
    const { token: readOnly } = mintApiToken(db, user.id, "reader", [
      "campaigns:read",
    ]);
    const noWrite = await app.request(`/api/v1/campaigns/${campaign.id}`, {
      method: "PUT",
      headers: { ...bearer(readOnly), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(noWrite.status).toBe(403);

    const member = db
      .insert(schema.users)
      .values({
        email: "member@example.com",
        passwordHash: "hash",
        role: "member",
      })
      .returning()
      .get();
    db.insert(schema.userLists)
      .values({ userId: member.id, listId: news.id })
      .run();
    const { token: memberToken } = mintApiToken(
      db,
      member.id,
      "member writer",
      ["campaigns:write"],
    );
    const forbidden = await mcpCall(app, memberToken, "campaign_update_draft", {
      id: campaign.id,
      campaign: input,
    });
    expect(forbidden.result.isError).toBe(true);
    expect(
      db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, campaign.id))
        .get()?.subject,
    ).toBe("Protected");
  });

  test("revoked tokens stop authenticating", async () => {
    const { app, db, user } = setup();
    const minted = mintApiToken(db, user.id, "temporary", ["lists:read"]);
    db.update(schema.apiTokens)
      .set({ revokedAt: new Date().toISOString() })
      .run();
    expect(
      (await app.request("/api/v1/lists", { headers: bearer(minted.token) }))
        .status,
    ).toBe(401);
  });

  test("subscriber deletion is confirmation-gated in both transports", async () => {
    const { app, db, user } = setup();
    const subscriber = db
      .insert(schema.subscribers)
      .values({ email: "delete@example.com", unsubscribeToken: "delete-token" })
      .returning()
      .get();
    db.insert(schema.events)
      .values({
        type: "subscriber.created",
        detail: subscriber.email,
        subscriberId: subscriber.id,
      })
      .run();
    const { token } = mintApiToken(db, user.id, "writer", [
      "subscribers:write",
    ]);
    expect(
      (
        await app.request(`/api/v1/subscribers/${subscriber.id}`, {
          method: "DELETE",
          headers: bearer(token),
        })
      ).status,
    ).toBe(400);
    expect(db.select().from(schema.subscribers).all()).toHaveLength(1);
    const mcp = await mcpCall(app, token, "subscriber_delete", {
      id: subscriber.id,
      confirm: false,
    });
    expect(mcp.result.isError).toBe(true);
    expect(db.select().from(schema.subscribers).all()).toHaveLength(1);
    expect(
      (
        await app.request(`/api/v1/subscribers/${subscriber.id}?confirm=true`, {
          method: "DELETE",
          headers: bearer(token),
        })
      ).status,
    ).toBe(200);
    expect(db.select().from(schema.subscribers).all()).toHaveLength(0);
    const historicalEvent = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "subscriber.created"))
      .get()!;
    expect(historicalEvent.subscriberId).toBeNull();
    const deletionEvent = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "api.subscriber_deleted"))
      .get()!;
    expect(JSON.parse(deletionEvent.meta!)).toEqual({
      subscriberId: subscriber.id,
    });
  });

  test("MCP initializes and advertises tools", async () => {
    const { app, db, user } = setup();
    const { token } = mintApiToken(db, user.id, "agent", ["lists:read"]);
    const response = await app.request("/mcp", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      }),
    });
    expect(response.status).toBe(200);
    const initialized = (await response.json()) as any;
    expect(initialized.result.serverInfo.name).toBe("lists");
    expect(initialized.result.protocolVersion).toBe("2025-11-25");

    const unknown = await app.request("/mcp/", {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "unknown/method",
        params: {},
      }),
    });
    expect(unknown.status).toBe(200);
    expect(((await unknown.json()) as any).error.code).toBe(-32601);
  });

  test("rejects bearer tokens that were not issued for the MCP resource", async () => {
    const { app, db, user } = setup();
    const unbound = mintScopedToken(db, user.id, "REST only", ["lists:read"]);
    expect(
      (await app.request("/api/v1/lists", { headers: bearer(unbound.token) }))
        .status,
    ).toBe(200);
    const mcp = await app.request("/mcp/", {
      method: "POST",
      headers: { ...bearer(unbound.token), "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    expect(mcp.status).toBe(401);
  });

  test("authors, previews, and replaces full HTML templates through shared MCP operations", async () => {
    const { app, db, user } = setup();
    const { token } = mintApiToken(db, user.id, "template author", [
      "templates:read",
      "templates:write",
    ]);
    const source = {
      slug: "personal-letter",
      name: "Personal Letter",
      description: "Agent-authored HTML",
      sourceFormat: "html",
      subjectSource: "A note for {{subscriber.firstName}}",
      htmlSource:
        '<!doctype html><html><body>{{> header}}<main>{{{sections.letter.html}}}</main><a href="{{links.unsubscribe}}">Leave</a></body></html>',
      textSource:
        "{{> text_header}}\n{{sections.letter.text}}\nLeave: {{links.unsubscribe}}",
      sections: [
        { key: "letter", name: "Letter", format: "markdown", required: true },
      ],
      partials: {
        header: "<header>Hello {{subscriber.firstName}}</header>",
        text_header: "Hello {{subscriber.firstName}}",
      },
    };
    const created = await mcpCall(app, token, "email_template_create", source);
    expect(created.result.isError).toBeUndefined();
    expect(created.result.structuredContent.status).toBe("active");
    expect(created.result.structuredContent.sourceFormat).toBe("html");
    const validated = await mcpCall(
      app,
      token,
      "email_template_validate",
      (({
        slug: _slug,
        name: _name,
        description: _description,
        ...templateSource
      }) => templateSource)(source),
    );
    expect(validated.result.structuredContent.valid).toBe(true);

    const preview = await mcpCall(app, token, "email_template_preview", {
      slug: source.slug,
      sectionSources: { letter: "# Complete control\n\nHello **world**." },
    });
    expect(preview.result.structuredContent.html).toContain(
      "<h1>Complete control</h1>",
    );
    expect(preview.result.structuredContent.html).toContain("Hello Jane");
    expect(preview.result.structuredContent.text).toContain("Hello world");

    const updated = await mcpCall(app, token, "email_template_update", {
      ...source,
      name: "Personal Letter Updated",
    });
    expect(updated.result.structuredContent.name).toBe(
      "Personal Letter Updated",
    );
    expect(updated.result.structuredContent.status).toBe("active");

    const rest = await app.request(`/api/v1/email-templates/${source.slug}`, {
      headers: bearer(token),
    });
    expect(rest.status).toBe(200);
    expect(((await rest.json()) as any).data.name).toBe(
      "Personal Letter Updated",
    );
    const duplicate = await mcpCall(app, token, "email_template_duplicate", {
      slug: source.slug,
      newSlug: "personal-letter-copy",
    });
    expect(duplicate.result.structuredContent.slug).toBe(
      "personal-letter-copy",
    );
    expect(duplicate.result.structuredContent.status).toBe("active");
  });

  test("requires templates:write and rejects executable HTML before persistence", async () => {
    const { app, db, user } = setup();
    const reader = mintApiToken(db, user.id, "template reader", [
      "templates:read",
    ]);
    const input = {
      slug: "unsafe",
      name: "Unsafe",
      sourceFormat: "html",
      htmlSource:
        '<html><body><script>alert(1)</script>{{{sections.content.html}}}<a href="{{links.unsubscribe}}">Leave</a></body></html>',
      textSource: "{{sections.content.text}} {{links.unsubscribe}}",
      sections: [
        { key: "content", name: "Content", format: "markdown", required: true },
      ],
      partials: {},
    };
    expect(
      (await mcpCall(app, reader.token, "email_template_create", input)).result
        .isError,
    ).toBe(true);
    const writer = mintApiToken(db, user.id, "template writer", [
      "templates:write",
    ]);
    const rejected = await mcpCall(
      app,
      writer.token,
      "email_template_create",
      input,
    );
    expect(rejected.result.isError).toBe(true);
    expect(rejected.result.content[0].text).toContain("forbidden <script>");
    expect(
      db
        .select()
        .from(schema.emailTemplates)
        .where(eq(schema.emailTemplates.slug, "unsafe"))
        .all(),
    ).toEqual([]);
  });

  test("rejects malformed and recursive sources without partial template writes", async () => {
    const { app, db, user } = setup();
    const { token } = mintApiToken(db, user.id, "template writer", [
      "templates:read",
      "templates:write",
    ]);
    const source = {
      slug: "atomic",
      name: "Atomic",
      sourceFormat: "html",
      htmlSource:
        '<html><body>{{{sections.content.html}}}<a href="{{links.unsubscribe}}">Leave</a></body></html>',
      textSource: "{{sections.content.text}} {{links.unsubscribe}}",
      sections: [
        { key: "content", name: "Content", format: "markdown", required: true },
      ],
      partials: {},
    };
    expect(
      (await mcpCall(app, token, "email_template_create", source)).result
        .isError,
    ).toBeUndefined();

    const malformed = await mcpCall(app, token, "email_template_update", {
      ...source,
      name: "Must not persist",
      htmlSource: `${source.htmlSource} {{#if`,
    });
    expect(malformed.result.isError).toBe(true);
    const stored = await app.request("/api/v1/email-templates/atomic", {
      headers: bearer(token),
    });
    const detail = ((await stored.json()) as any).data;
    expect(detail.name).toBe("Atomic");
    expect(detail.htmlSource).toBe(source.htmlSource);

    const recursive = await mcpCall(app, token, "email_template_create", {
      ...source,
      slug: "recursive",
      name: "Recursive",
      htmlSource:
        '<html><body>{{> loop}}{{{sections.content.html}}}<a href="{{links.unsubscribe}}">Leave</a></body></html>',
      partials: { loop: "{{> loop}}" },
    });
    expect(recursive.result.isError).toBe(true);
    expect(recursive.result.content[0].text).toContain(
      "Recursive partial chain",
    );
    expect(
      db
        .select()
        .from(schema.emailTemplates)
        .where(eq(schema.emailTemplates.slug, "recursive"))
        .all(),
    ).toEqual([]);
  });

  test("compiles MJML templates while preserving Handlebars sections", async () => {
    const { app, db, user } = setup();
    const { token } = mintApiToken(db, user.id, "mjml author", [
      "templates:read",
      "templates:write",
    ]);
    const created = await mcpCall(app, token, "email_template_create", {
      slug: "responsive",
      name: "Responsive",
      sourceFormat: "mjml",
      htmlSource:
        '<mjml><mj-body><mj-section><mj-column><mj-text>{{{sections.content.html}}}</mj-text><mj-text><a href="{{links.unsubscribe}}">Unsubscribe</a></mj-text></mj-column></mj-section></mj-body></mjml>',
      textSource: "{{sections.content.text}}\n{{links.unsubscribe}}",
      sections: [
        { key: "content", name: "Content", format: "markdown", required: true },
      ],
      partials: {},
    });
    expect(created.result.isError).toBeUndefined();
    expect(created.result.structuredContent.compiledHtml).toContain(
      'role="article"',
    );
  });
});

describe("OAuth PKCE", () => {
  test("publishes protected-resource and authorization-server metadata", async () => {
    const { app } = setup();
    const resource = await app.request("/.well-known/oauth-protected-resource");
    const server = await app.request("/.well-known/oauth-authorization-server");
    expect(resource.status).toBe(200);
    expect(((await resource.json()) as any).resource).toBe(
      "http://localhost/mcp",
    );
    expect(
      ((await server.json()) as any).code_challenge_methods_supported,
    ).toEqual(["S256"]);
  });
  test("registers a client and exchanges a user-approved code", async () => {
    const { app, db, user } = setup();
    const registered = await app.request("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Codex",
        redirect_uris: ["http://localhost/callback"],
      }),
    });
    expect(registered.status).toBe(201);
    expect(registered.headers.get("cache-control")).toBe("no-store");
    expect(registered.headers.get("pragma")).toBe("no-cache");
    const client = (await registered.json()) as any;
    const verifier = "a".repeat(64);
    const challenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ).toString("base64url");
    const session = createSession(db, user.id);
    const authorizationParams = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "http://localhost/callback",
      response_type: "code",
      scope: "lists:read dmarc:read",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "abc",
      resource: "http://localhost/mcp",
    });
    const approval = await app.request(
      `/oauth/authorize?${authorizationParams}`,
      {
        headers: { Cookie: `session=${session}` },
      },
    );
    expect(approval.status).toBe(200);
    expect(await approval.text()).toContain('name="resource"');
    const authorize = await app.request("/oauth/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `session=${session}`,
      },
      body: new URLSearchParams({
        decision: "allow",
        client_id: client.client_id,
        redirect_uri: "http://localhost/callback",
        response_type: "code",
        scope: "lists:read dmarc:read",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "abc",
        resource: "http://localhost/mcp",
      }),
    });
    expect(authorize.status).toBe(302);
    const redirect = new URL(authorize.headers.get("location")!);
    expect(redirect.searchParams.get("state")).toBe("abc");

    const tokenFields = {
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code")!,
      client_id: client.client_id,
      redirect_uri: "http://localhost/callback",
      code_verifier: verifier,
    };
    const wrongAudience = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenFields),
    });
    expect(wrongAudience.status).toBe(400);
    expect(await wrongAudience.json()).toEqual({ error: "invalid_target" });

    const exchanged = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...tokenFields,
        resource: "http://localhost/mcp",
      }),
    });
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get("cache-control")).toBe("no-store");
    const tokens = (await exchanged.json()) as any;
    expect(tokens.access_token).toStartWith("lst_");
    expect(tokens.refresh_token).toStartWith("lst_refresh_");
    expect(
      (
        await app.request("/api/v1/lists", {
          headers: bearer(tokens.access_token),
        })
      ).status,
    ).toBe(200);
    const mcp = await app.request("/mcp/", {
      method: "POST",
      headers: {
        ...bearer(tokens.access_token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    expect(mcp.status).toBe(200);

    const refreshBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
      resource: "http://localhost/mcp",
      scope: "lists:read",
    });
    const refreshed = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: refreshBody,
    });
    expect(refreshed.status).toBe(200);
    const rotated = (await refreshed.json()) as any;
    expect(rotated.refresh_token).toStartWith("lst_refresh_");
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    expect(rotated.scope).toBe("lists:read");
    const replay = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: refreshBody,
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "invalid_grant" });
  });

  test("accepts standard dynamic-registration metadata sent by MCP clients", async () => {
    const { app } = setup();
    const response = await app.request("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Codex",
        redirect_uris: ["http://127.0.0.1:1455/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "lists:read templates:read",
        software_id: "codex-cli",
      }),
    });
    expect(response.status).toBe(201);
    const metadata = (await response.json()) as any;
    expect(metadata.token_endpoint_auth_method).toBe("none");
    expect(metadata.scope).toBe("lists:read templates:read");
  });

  test("escapes self-asserted client metadata on the approval page", async () => {
    const { app, db, user } = setup();
    const registered = await app.request("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "<img src=x onerror=alert(1)>",
        redirect_uris: ["http://127.0.0.1/callback"],
      }),
    });
    const client = (await registered.json()) as any;
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1/callback",
      response_type: "code",
      scope: "lists:read",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
      resource: "http://localhost/mcp",
    });
    const approval = await app.request(`/oauth/authorize?${query}`, {
      headers: { Cookie: `session=${createSession(db, user.id)}` },
    });
    const html = await approval.text();
    expect(approval.status).toBe(200);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });

  test("rejects insecure redirects, unsupported clients, and incorrect resource targets", async () => {
    const { app } = setup();
    for (const redirect_uri of [
      "http://example.com/callback",
      "https://example.com/callback#fragment",
      "https://user:pass@example.com/callback",
    ]) {
      const response = await app.request("/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [redirect_uri] }),
      });
      expect(response.status).toBe(400);
    }
    const confidential = await app.request("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "client_secret_basic",
      }),
    });
    expect(confidential.status).toBe(400);
    expect(((await confidential.json()) as any).error).toBe(
      "invalid_client_metadata",
    );
    const unknownScope = await app.request("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://127.0.0.1/callback"],
        scope: "lists:read root:everything",
      }),
    });
    expect(unknownScope.status).toBe(400);
    expect(((await unknownScope.json()) as any).error).toBe(
      "invalid_client_metadata",
    );
  });

  test("rejects malformed protocol inputs before credential logic", async () => {
    const { app, db } = setup();
    const registration = await app.request("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Broken",
        redirect_uris: ["not-a-url"],
      }),
    });
    expect(registration.status).toBe(400);
    expect(db.select().from(schema.oauthClients).all()).toEqual([]);

    const token = await app.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "missing-fields",
      }),
    });
    expect(token.status).toBe(400);
    expect(await token.json()).toEqual({ error: "invalid_request" });
  });
});
