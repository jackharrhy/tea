import { spawnSync } from "node:child_process";
import { loadWorkspaces } from "./affected.mjs";

const selected = JSON.parse(process.env.SELECTED_CHECKS || "[]");
const workspaces = loadWorkspaces();
const failed = [];

for (const name of selected) {
  const workspace = workspaces.find((item) => item.name === name);
  if (!workspace?.manifest.scripts?.check) {
    throw new Error(`No check script for ${name}`);
  }

  console.log(`\nChecking ${name}`);
  const result = spawnSync("npm", ["run", "check", "--workspace", name], {
    stdio: "inherit",
  });
  if (result.status !== 0) failed.push(name);
}

if (failed.length > 0) {
  console.error(`Failed workspaces: ${failed.join(", ")}`);
  process.exitCode = 1;
}
