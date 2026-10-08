import * as assert from "remix/assert";
import { describe, it } from "remix/test";

import { loadConfig } from "../app/config.ts";

describe("loadConfig", () => {
  it("defaults to anonymous mode when MARKY_AUTH is unset", () => {
    const config = loadConfig({});
    assert.equal(config.auth.mode, "anonymous");
  });

  it("treats MARKY_AUTH=anonymous as anonymous mode", () => {
    const config = loadConfig({ MARKY_AUTH: "anonymous" });
    assert.equal(config.auth.mode, "anonymous");
  });

  it("rejects unknown MARKY_AUTH values", () => {
    assert.throws(
      () => loadConfig({ MARKY_AUTH: "github" }),
      /MARKY_AUTH must be "anonymous" or "discord"/,
    );
  });

  it("ignores Discord vars in anonymous mode", () => {
    const config = loadConfig({
      MARKY_AUTH: "anonymous",
      DISCORD_CLIENT_ID: "leftover",
      DISCORD_CLIENT_SECRET: "leftover",
    });
    assert.equal(config.auth.mode, "anonymous");
  });

  it("parses discord mode with all required vars", () => {
    const config = loadConfig({
      MARKY_AUTH: "discord",
      DISCORD_CLIENT_ID: "cid",
      DISCORD_CLIENT_SECRET: "csecret",
      DISCORD_GUILD_ID: "gid",
      MARKY_BASE_URL: "https://marky.example.com",
      SESSION_SECRET: "sssh",
    });
    assert.equal(config.auth.mode, "discord");
    if (config.auth.mode !== "discord") throw new Error("unreachable");
    assert.equal(config.auth.clientId, "cid");
    assert.equal(config.auth.clientSecret, "csecret");
    assert.equal(config.auth.guildId, "gid");
    assert.equal(config.auth.baseUrl, "https://marky.example.com");
    assert.equal(config.auth.sessionSecret, "sssh");
    assert.equal(config.auth.botToken, undefined);
  });

  it("captures the optional bot token in discord mode", () => {
    const config = loadConfig({
      MARKY_AUTH: "discord",
      DISCORD_CLIENT_ID: "cid",
      DISCORD_CLIENT_SECRET: "csecret",
      DISCORD_GUILD_ID: "gid",
      MARKY_BASE_URL: "https://marky.example.com",
      SESSION_SECRET: "sssh",
      DISCORD_BOT_TOKEN: "bot",
    });
    assert.equal(config.auth.mode === "discord" && config.auth.botToken, "bot");
  });

  it("lists every missing required var in discord mode", () => {
    assert.throws(
      () => loadConfig({ MARKY_AUTH: "discord" }),
      (error: Error) => {
        assert.match(error.message, /DISCORD_CLIENT_ID/);
        assert.match(error.message, /DISCORD_CLIENT_SECRET/);
        assert.match(error.message, /DISCORD_GUILD_ID/);
        assert.match(error.message, /SESSION_SECRET/);
        assert.doesNotMatch(error.message, /MARKY_BASE_URL/);
        return true;
      },
    );
  });

  it("defaults MARKY_BASE_URL to http://localhost:<port> when unset", () => {
    const config = loadConfig({
      MARKY_AUTH: "discord",
      DISCORD_CLIENT_ID: "cid",
      DISCORD_CLIENT_SECRET: "csecret",
      DISCORD_GUILD_ID: "gid",
      SESSION_SECRET: "sssh",
    });
    if (config.auth.mode !== "discord") throw new Error("unreachable");
    assert.equal(config.auth.baseUrl, "http://localhost:44100");
  });

  it("uses the configured PORT in the default MARKY_BASE_URL", () => {
    const config = loadConfig({
      MARKY_AUTH: "discord",
      PORT: "8080",
      DISCORD_CLIENT_ID: "cid",
      DISCORD_CLIENT_SECRET: "csecret",
      DISCORD_GUILD_ID: "gid",
      SESSION_SECRET: "sssh",
    });
    if (config.auth.mode !== "discord") throw new Error("unreachable");
    assert.equal(config.auth.baseUrl, "http://localhost:8080");
  });

  it("strips trailing slash from MARKY_BASE_URL", () => {
    const config = loadConfig({
      MARKY_AUTH: "discord",
      DISCORD_CLIENT_ID: "cid",
      DISCORD_CLIENT_SECRET: "csecret",
      DISCORD_GUILD_ID: "gid",
      MARKY_BASE_URL: "https://marky.example.com/",
      SESSION_SECRET: "sssh",
    });
    assert.equal(
      config.auth.mode === "discord" && config.auth.baseUrl,
      "https://marky.example.com",
    );
  });

  it("parses PORT and MARKY_CONTENT_DIR with sensible defaults", () => {
    const config = loadConfig({});
    assert.equal(config.port, 44100);
    assert.equal(typeof config.contentDir, "string");
    assert.ok(config.contentDir.endsWith("content"));
  });

  it("parses a custom PORT", () => {
    const config = loadConfig({ PORT: "8080" });
    assert.equal(config.port, 8080);
  });

  it("rejects an invalid PORT", () => {
    assert.throws(
      () => loadConfig({ PORT: "not-a-number" }),
      /PORT must be a number/,
    );
  });

  it("treats whitespace-only discord vars as missing", () => {
    assert.throws(
      () =>
        loadConfig({
          MARKY_AUTH: "discord",
          DISCORD_CLIENT_ID: "   ",
          DISCORD_CLIENT_SECRET: "\t",
          DISCORD_GUILD_ID: "gid",
          MARKY_BASE_URL: "https://marky.example.com",
          SESSION_SECRET: "sssh",
        }),
      (error: Error) => {
        assert.match(error.message, /DISCORD_CLIENT_ID/);
        assert.match(error.message, /DISCORD_CLIENT_SECRET/);
        assert.doesNotMatch(error.message, /DISCORD_GUILD_ID/);
        return true;
      },
    );
  });

  it("trims whitespace from discord values", () => {
    const config = loadConfig({
      MARKY_AUTH: "discord",
      DISCORD_CLIENT_ID: "  cid  ",
      DISCORD_CLIENT_SECRET: "csecret",
      DISCORD_GUILD_ID: "gid",
      MARKY_BASE_URL: "  https://marky.example.com/  ",
      SESSION_SECRET: "sssh",
      DISCORD_BOT_TOKEN: "   ",
    });
    if (config.auth.mode !== "discord") throw new Error("unreachable");
    assert.equal(config.auth.clientId, "cid");
    assert.equal(config.auth.baseUrl, "https://marky.example.com");
    assert.equal(config.auth.botToken, undefined);
  });

  it("does not populate git config when MARKY_GIT_REPO is unset", () => {
    const config = loadConfig({});
    assert.equal(config.git, undefined);
  });

  it("populates git config with sensible defaults when MARKY_GIT_REPO is set", () => {
    const config = loadConfig({ MARKY_GIT_REPO: "/tmp/repo" });
    assert.ok(config.git);
    assert.equal(config.git.repoDir, "/tmp/repo");
    assert.equal(config.git.authorName, "marky-bot");
    assert.equal(config.git.authorEmail, "marky-bot@localhost");
    assert.equal(config.git.persistIdleMs, 60_000);
    assert.equal(config.git.pushIntervalMs, 300_000);
    assert.equal(config.git.push, undefined);
  });

  it("derives the git author email from MARKY_BASE_URL host when available", () => {
    const config = loadConfig({
      MARKY_AUTH: "discord",
      DISCORD_CLIENT_ID: "cid",
      DISCORD_CLIENT_SECRET: "csecret",
      DISCORD_GUILD_ID: "gid",
      SESSION_SECRET: "sssh",
      MARKY_BASE_URL: "https://marky.example.com",
      MARKY_GIT_REPO: "/tmp/repo",
    });
    assert.equal(config.git?.authorEmail, "marky-bot@marky.example.com");
  });

  it("honors explicit MARKY_GIT_AUTHOR_NAME and MARKY_GIT_AUTHOR_EMAIL", () => {
    const config = loadConfig({
      MARKY_GIT_REPO: "/tmp/repo",
      MARKY_GIT_AUTHOR_NAME: "Custom Bot",
      MARKY_GIT_AUTHOR_EMAIL: "custom@example.com",
    });
    assert.equal(config.git?.authorName, "Custom Bot");
    assert.equal(config.git?.authorEmail, "custom@example.com");
  });

  it("parses MARKY_PERSIST_IDLE_MS and MARKY_PUSH_INTERVAL_MS as integers", () => {
    const config = loadConfig({
      MARKY_GIT_REPO: "/tmp/repo",
      MARKY_PERSIST_IDLE_MS: "5000",
      MARKY_PUSH_INTERVAL_MS: "0",
    });
    assert.equal(config.git?.persistIdleMs, 5000);
    assert.equal(config.git?.pushIntervalMs, 0);
  });

  it("rejects invalid MARKY_PERSIST_IDLE_MS", () => {
    assert.throws(
      () => loadConfig({ MARKY_GIT_REPO: "/r", MARKY_PERSIST_IDLE_MS: "oops" }),
      /MARKY_PERSIST_IDLE_MS must be a number/,
    );
  });

  it("rejects invalid MARKY_PUSH_INTERVAL_MS", () => {
    assert.throws(
      () =>
        loadConfig({ MARKY_GIT_REPO: "/r", MARKY_PUSH_INTERVAL_MS: "oops" }),
      /MARKY_PUSH_INTERVAL_MS must be a number/,
    );
  });

  it("populates push.pat when MARKY_GIT_PUSH=true and MARKY_GIT_PAT is set", () => {
    const config = loadConfig({
      MARKY_GIT_REPO: "/tmp/repo",
      MARKY_GIT_PUSH: "true",
      MARKY_GIT_PAT: "ghp_abc",
    });
    assert.deepEqual(config.git?.push, { pat: "ghp_abc" });
  });

  it("rejects MARKY_GIT_PUSH=true without MARKY_GIT_PAT", () => {
    assert.throws(
      () => loadConfig({ MARKY_GIT_REPO: "/tmp/repo", MARKY_GIT_PUSH: "true" }),
      /MARKY_GIT_PUSH=true requires MARKY_GIT_PAT/,
    );
  });

  it("rejects MARKY_GIT_PAT when MARKY_GIT_REPO is unset", () => {
    assert.throws(
      () => loadConfig({ MARKY_GIT_PAT: "ghp_abc" }),
      /MARKY_GIT_PAT requires MARKY_GIT_REPO/,
    );
  });

  it("ignores MARKY_GIT_PUSH when set to a falsy value", () => {
    const config = loadConfig({
      MARKY_GIT_REPO: "/tmp/repo",
      MARKY_GIT_PUSH: "false",
    });
    assert.equal(config.git?.push, undefined);
  });
});
