import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../app/config.ts";

const liveEnvironment = {
  SHELL_MODE: "fourorm",
  PUBLIC_ORIGIN: "https://shell.example",
  FOURORM_ISSUER: "https://identity.example",
  SHELL_AUTHORIZATION_SERVER: "https://identity.example/authorize",
  SHELL_REQUIRED_SCOPE: "shell:execute",
  SHELL_ALLOWED_SUBJECTS: "owner-1, owner-2",
  SHELL_ALLOWED_USERNAMES: "jack",
  FOURORM_INTROSPECTION_CLIENT_ID: "shell",
  FOURORM_INTROSPECTION_SECRET_FILE: "/run/secrets/introspection",
};

test("live settings identify the invalid field without exposing its value", () => {
  const secret = "do-not-report-this-value";
  assert.throws(
    () =>
      readConfig({
        ...liveEnvironment,
        FOURORM_ISSUER: secret,
      }),
    (error: Error) => {
      assert.match(error.message, /FOURORM_ISSUER/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("live mode validates origins and normalizes owner lists", () => {
  const config = readConfig(liveEnvironment);
  assert.equal(config.mode, "fourorm");
  if (config.mode !== "fourorm") return;
  assert.deepEqual(config.allowedSubjects, ["owner-1", "owner-2"]);
  assert.equal(config.runner, "disabled");
  assert.equal("helperPath" in config, false);

  assert.throws(
    () =>
      readConfig({
        ...liveEnvironment,
        SHELL_AUTHORIZATION_SERVER: "https://other.example/authorize",
      }),
    /issuer origin/,
  );
  assert.throws(
    () =>
      readConfig({
        ...liveEnvironment,
        PUBLIC_ORIGIN: "https://shell.example/mcp",
      }),
    /PUBLIC_ORIGIN/,
  );
});

test("systemd settings are required only for the systemd runner", () => {
  assert.throws(
    () => readConfig({ ...liveEnvironment, SHELL_RUNNER: "systemd" }),
    /SHELL_JOURNAL_FILE/,
  );
  const config = readConfig({
    ...liveEnvironment,
    SHELL_RUNNER: "systemd",
    SHELL_JOURNAL_FILE: "/var/lib/shell/jobs.jsonl",
    SHELL_HELPER_PATH: "/usr/local/libexec/shell-job",
  });
  assert.equal(config.runner, "systemd");
  if (config.runner === "systemd") {
    assert.equal(config.helperPath, "/usr/local/libexec/shell-job");
  }
});
