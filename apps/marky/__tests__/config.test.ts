import * as assert from "remix/assert";
import { describe, it } from "remix/test";

import { loadConfig } from "../app/config.ts";

const centralEnv = {
  MARKY_AUTH: "central",
  AUTH_ISSUER: "https://auth.example.test",
  AUTH_CLIENT_ID: "marky-web",
  AUTH_PROJECT_ID: "marky-project",
  AUTH_ORGANIZATION_ID: "marky-org",
  MARKY_BASE_URL: "https://md.example.test",
  SESSION_SECRET: "secret-for-session-signing",
};

describe("loadConfig", () => {
  it("uses anonymous mode locally and rejects retired login modes", () => {
    assert.equal(loadConfig({}).auth.mode, "anonymous");
    assert.equal(
      loadConfig({ MARKY_AUTH: "anonymous" }).auth.mode,
      "anonymous",
    );
    assert.throws(
      () => loadConfig({ MARKY_AUTH: "discord" }),
      /MARKY_AUTH must be "anonymous" or "central"/,
    );
  });

  it("requires an exact HTTPS Central Auth configuration", () => {
    const config = loadConfig(centralEnv);
    assert.equal(config.auth.mode, "central");
    if (config.auth.mode !== "central") throw new Error("test setup failed");
    assert.equal(config.auth.identity.projectId, "marky-project");
    assert.equal(config.auth.baseUrl, "https://md.example.test");
    assert.throws(
      () => loadConfig({ ...centralEnv, AUTH_PROJECT_ID: "" }),
      /AUTH_PROJECT_ID/,
    );
    assert.throws(
      () =>
        loadConfig({ ...centralEnv, MARKY_BASE_URL: "http://md.example.test" }),
      /HTTPS/,
    );
  });

  it("parses the port and content directory", () => {
    const config = loadConfig({
      PORT: "8080",
      MARKY_CONTENT_DIR: "/tmp/marky",
    });
    assert.equal(config.port, 8080);
    assert.equal(config.contentDir, "/tmp/marky");
    assert.throws(() => loadConfig({ PORT: "bad" }), /PORT must be a number/);
  });

  it("keeps git persistence settings independent of login mode", () => {
    const config = loadConfig({
      ...centralEnv,
      MARKY_GIT_REPO: "/tmp/repo",
      MARKY_GIT_AUTHOR_NAME: "Marky",
      MARKY_GIT_AUTHOR_EMAIL: "marky@example.test",
      MARKY_PERSIST_IDLE_MS: "5000",
      MARKY_PUSH_INTERVAL_MS: "0",
    });
    assert.equal(config.git?.repoDir, "/tmp/repo");
    assert.equal(config.git?.authorName, "Marky");
    assert.equal(config.git?.authorEmail, "marky@example.test");
    assert.equal(config.git?.persistIdleMs, 5000);
    assert.equal(config.git?.pushIntervalMs, 0);
  });
});
