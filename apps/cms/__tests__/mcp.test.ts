import { it } from "remix/test";
import { LATEST_PROTOCOL_VERSION, MetaKey } from "@harrhy/mcp";
import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFixtureSites } from "./sites.ts";
import { createApp } from "../app.ts";
import { seedFixture } from "./fixture.ts";
import { openDatabase } from "../app/data/database.ts";
import { createContentStore } from "../app/data/content.ts";

it("keeps the per-site MCP endpoint disabled until configured and requires its bearer token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "teacms-mcp-"));
  const [site] = parseFixtureSites(
    [
      {
        id: "one",
        template: "andrew",
        name: "MCP fixture",
        origin: "https://one.example.test",
        aliases: [],
        preview: false,
      },
    ],
    dir,
  );
  const app = await createApp([site]);
  await seedFixture(site);
  const draftDatabase = await openDatabase(join(site.dataDir, "tea.db"));
  try {
    const draft = createContentStore(draftDatabase.sqlite).createPage(
      "Private Draft",
      "private-draft",
    );
    assert.equal(draft.ok, true);
  } finally {
    draftDatabase.sqlite.close();
  }
  const previous = process.env.TEA_MCP_TOKEN;
  const request = (authorization?: string) =>
    app.fetch(
      new Request("https://one.example.test/tea/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
          "Mcp-Method": "tools/list",
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: {
              [MetaKey.ProtocolVersion]: LATEST_PROTOCOL_VERSION,
              [MetaKey.ClientCapabilities]: {},
            },
          },
        }),
      }),
    );
  try {
    delete process.env.TEA_MCP_TOKEN;
    assert.equal((await request()).status, 404);
    process.env.TEA_MCP_TOKEN = "fixture-secret";
    assert.equal((await request()).status, 401);
    const response = await request("Bearer fixture-secret");
    const body = await response.text();
    assert.equal(response.status, 200, body);
    const result = JSON.parse(body);
    assert.deepEqual(
      result.result.tools.map((tool: { name: string }) => tool.name),
      ["list_published_pages", "get_published_page"],
    );
    const pageResponse = await app.fetch(
      new Request("https://one.example.test/tea/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
          "Mcp-Method": "tools/call",
          "Mcp-Name": "get_published_page",
          Authorization: "Bearer fixture-secret",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "get_published_page",
            arguments: { slug: "example" },
            _meta: {
              [MetaKey.ProtocolVersion]: LATEST_PROTOCOL_VERSION,
              [MetaKey.ClientCapabilities]: {},
            },
          },
        }),
      }),
    );
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /Example page/);
    const listResponse = await app.fetch(
      new Request("https://one.example.test/tea/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
          "Mcp-Method": "tools/call",
          "Mcp-Name": "list_published_pages",
          Authorization: "Bearer fixture-secret",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "list_published_pages",
            arguments: {},
            _meta: {
              [MetaKey.ProtocolVersion]: LATEST_PROTOCOL_VERSION,
              [MetaKey.ClientCapabilities]: {},
            },
          },
        }),
      }),
    );
    assert.equal(listResponse.status, 200);
    assert.doesNotMatch(
      await listResponse.text(),
      /Private Draft|private-draft/,
    );
    const draftResponse = await app.fetch(
      new Request("https://one.example.test/tea/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
          "Mcp-Method": "tools/call",
          "Mcp-Name": "get_published_page",
          Authorization: "Bearer fixture-secret",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "get_published_page",
            arguments: { slug: "private-draft" },
            _meta: {
              [MetaKey.ProtocolVersion]: LATEST_PROTOCOL_VERSION,
              [MetaKey.ClientCapabilities]: {},
            },
          },
        }),
      }),
    );
    assert.doesNotMatch(
      await draftResponse.text(),
      /Private Draft|private-draft/,
    );
  } finally {
    if (previous === undefined) delete process.env.TEA_MCP_TOKEN;
    else process.env.TEA_MCP_TOKEN = previous;
    app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
