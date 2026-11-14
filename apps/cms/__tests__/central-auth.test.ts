import { it } from "remix/test";
import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app.ts";
import { createAuthStore } from "../app/data/auth.ts";
import { openDatabase } from "../app/data/database.ts";
import { createOperatorStore } from "../operator/store.ts";
import { parseFixtureSites } from "./sites.ts";

it("requires reviewed local links and rejects old CMS password sessions in Central mode", async () => {
  const names = [
    "TEA_AUTH_ISSUER",
    "TEA_AUTH_PROJECT_ID",
    "TEA_AUTH_ORGANIZATION_ID",
    "TEA_AUTH_OPERATOR_CLIENT_ID",
    "TEA_AUTH_ANDREW_CLIENT_ID",
  ] as const;
  const previous = names.map((name) => process.env[name]);
  Object.assign(process.env, {
    TEA_AUTH_ISSUER: "https://auth.example.test",
    TEA_AUTH_PROJECT_ID: "cms-project",
    TEA_AUTH_ORGANIZATION_ID: "cms-org",
    TEA_AUTH_OPERATOR_CLIENT_ID: "cms-operator",
    TEA_AUTH_ANDREW_CLIENT_ID: "cms-andrew",
  });
  const dir = await mkdtemp(join(tmpdir(), "cms-central-"));
  const site = parseFixtureSites(
    [
      {
        id: "andrew",
        template: "andrew",
        name: "Andrew",
        origin: "https://andrew.example.test",
        aliases: [],
        preview: false,
      },
    ],
    dir,
  )[0];
  const database = await openDatabase(join(site.dataDir, "tea.db"));
  const row = database.sqlite
    .prepare(
      "INSERT INTO users(email,password_hash,auth_subject) VALUES (?,?,?)",
    )
    .run("editor@example.test", "unused", "editor-subject");
  const oldSiteSession = createAuthStore(database.sqlite).createSession(
    Number(row.lastInsertRowid),
  );
  database.sqlite.close();
  const operator = createOperatorStore(":memory:", true);
  operator.sqlite
    .prepare(
      "INSERT INTO users(email,password_hash,auth_subject) VALUES (?,?,?)",
    )
    .run("operator@example.test", "unused", "operator-subject");
  const oldOperatorSession = createAuthStore(operator.sqlite).createSession(1);
  const app = await createApp([site], {
    origin: "https://operator.example.test",
    store: operator,
  });
  try {
    const get = (url: string, cookie?: string) =>
      app.fetch(
        new Request(url, { headers: cookie ? { Cookie: cookie } : {} }),
      );
    assert.equal(
      (
        await get(
          "https://operator.example.test/",
          `tea-operator-session=${oldOperatorSession.id}`,
        )
      ).status,
      303,
    );
    assert.equal(
      (
        await get(
          "https://andrew.example.test/tea/admin",
          `tea-session-andrew=${oldSiteSession.id}`,
        )
      ).status,
      303,
    );
    for (const login of [
      "https://operator.example.test/login",
      "https://andrew.example.test/tea/login",
    ]) {
      const html = await (await get(login)).text();
      assert.match(html, /href="[^"]*\/auth\/login"[^>]*>Sign in<\/a>/);
      assert.doesNotMatch(html, /Jack\s*Auth/i);
    }
    const metadata = await get(
      "https://andrew.example.test/.well-known/oauth-protected-resource/tea/mcp",
    );
    assert.equal(metadata.status, 200);
    assert.equal(
      (await metadata.json()).resource,
      "https://andrew.example.test/tea/mcp",
    );
    const password = await app.fetch(
      new Request("https://andrew.example.test/tea/login", {
        method: "POST",
        headers: { Origin: site.origin },
        body: new URLSearchParams({
          email: "editor@example.test",
          password: "ignored",
        }),
      }),
    );
    assert.equal(password.status, 404);
  } finally {
    app.close();
    await rm(dir, { recursive: true, force: true });
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
