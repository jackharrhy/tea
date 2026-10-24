import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const workers = [
  ["apps/ref", "wrangler", "worker-configuration.d.ts"],
  ["apps/radio", "wrangler", "worker-configuration.d.ts"],
  ["apps/maps-collaboration", "wrangler", "worker-configuration.d.ts"],
  ["apps/cms-edge", "cf", ".cloudflare/types/index.d.ts"],
];

for (const [workspace, tool, typesFile] of workers) {
  if (existsSync(join(workspace, typesFile))) continue;
  const command = join("../../node_modules/.bin", tool);
  const args =
    tool === "cf"
      ? ["workers", "types"]
      : ["types", typesFile, "--env-file", ".dev.vars.example"];
  const result = spawnSync(command, args, {
    cwd: workspace,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
