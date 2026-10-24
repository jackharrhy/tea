import { spawnSync } from "node:child_process";
import tsrslint from "@maschwenk/tsrslint";

const result = spawnSync(
  "node_modules/.bin/vp",
  [process.argv[2] ?? "check", ...process.argv.slice(3)],
  {
    env: { ...process.env, OXLINT_TSGOLINT_PATH: tsrslint.binaryPath() },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
