import { spawnSync } from "node:child_process";
import { loadWorkspaces, planChecks } from "./affected.mjs";

const selected = JSON.parse(process.env.SELECTED_CHECKS || "[]");
const workspaces = loadWorkspaces();
for (const { name, script } of planChecks(selected, workspaces)) {
  console.log(
    `\n${script === "check" ? "Checking" : "Building dependency"} ${name}`,
  );
  const result = spawnSync("npm", ["run", script, "--workspace", name], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`${script} failed for ${name}`);
    process.exit(result.status || 1);
  }
}
