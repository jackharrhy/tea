import { createJobManager, createMockRunner } from "./execution/index.ts";
import { createFourormIdentity } from "./auth/fourorm.ts";
import { demoIdentity, lockedIdentity } from "./auth/fixtures.ts";
import { readIntrospectionSecret } from "./auth/secret.ts";
import type { AppConfig } from "./config.ts";
import { createSystemdRunner } from "./systemd-runner.ts";

export async function createRuntime(config: AppConfig) {
  switch (config.mode) {
    case "locked":
      return { identity: lockedIdentity, jobs: createJobManager() };
    case "demo":
      return {
        identity: demoIdentity,
        jobs: createJobManager({ runner: createMockRunner() }),
      };
    case "fourorm": {
      const identity = await createFourormIdentity({
        issuer: config.issuer,
        resource: config.resource,
        requiredScope: config.requiredScope,
        allowedSubjects: config.allowedSubjects,
        allowedUsernames: config.allowedUsernames,
        introspectionClientId: config.introspectionClientId,
        introspectionClientSecret: await readIntrospectionSecret(
          config.introspectionSecretFile,
        ),
      });
      const jobs =
        config.runner === "systemd"
          ? createJobManager({
              runner: createSystemdRunner(config.helperPath),
              journalFile: config.journalFile,
            })
          : createJobManager();
      return { identity, jobs };
    }
  }
}
