import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "@tea/shell-core/router.ts";
import { readConfig } from "../app/config.ts";
import { lockedIdentity } from "../app/auth/fixtures.ts";
import { JobManager } from "@tea/shell-core/execution/index.ts";

test("shell discovery selects resource-specific registration, not Artbin defaults", async () => {
  const config = readConfig({
    SHELL_MODE: "fourorm",
    PUBLIC_ORIGIN: "https://jackharrhy.dev",
    FOURORM_ISSUER: "https://4orm.harrhy.xyz",
    SHELL_AUTHORIZATION_SERVER: "https://4orm.harrhy.xyz/newport-shell",
    SHELL_REQUIRED_SCOPE: "newport-shell:execute",
    SHELL_ALLOWED_USERNAMES: "harrhy",
    SHELL_ALLOWED_SUBJECTS: "1",
    FOURORM_INTROSPECTION_CLIENT_ID: "fixture",
    FOURORM_INTROSPECTION_SECRET_FILE: "/fixture",
  });
  const jobs = new JobManager();
  try {
    const app = createApp(config, lockedIdentity, jobs);
    const metadata = (await (
      await app.fetch(
        new Request(
          "https://jackharrhy.dev/.well-known/oauth-protected-resource/mcp",
        ),
      )
    ).json()) as any;
    assert.deepEqual(metadata.authorization_servers, [
      "https://4orm.harrhy.xyz/newport-shell",
    ]);
    assert.deepEqual(metadata.scopes_supported, [
      "openid",
      "newport-shell:execute",
    ]);
    assert.equal(config.issuer, "https://4orm.harrhy.xyz");
  } finally {
    await jobs.close();
  }
});
