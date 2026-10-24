import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

for (const group of ["apps", "packages"]) {
  for (const workspace of readdirSync(group)) {
    const project = join(group, workspace, "tsconfig.json");
    if (!existsSync(project)) continue;
    const result = spawnSync(
      "node_modules/.bin/tsrs",
      ["-p", project, "--noEmit"],
      {
        stdio: "inherit",
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error(`tsrs failed: ${project}`);
      process.exit(result.status ?? 1);
    }
  }
}
