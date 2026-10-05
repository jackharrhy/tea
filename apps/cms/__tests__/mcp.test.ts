import { it } from "remix/test";
import { LATEST_PROTOCOL_VERSION, MetaKey } from "@sdxc/mcp";
import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFixtureSites } from "./sites.ts";
import { createApp } from "../app.ts";
import { seedFixture } from "./fixture.ts";

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
  } finally {
    if (previous === undefined) delete process.env.TEA_MCP_TOKEN;
    else process.env.TEA_MCP_TOKEN = previous;
    app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
