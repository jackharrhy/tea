import { mkdir } from "node:fs/promises";
import { runRealNetworkHarness } from "./real-harness";
import { networkBudgetFailures } from "./release-budgets";

const quick = process.env.HARNESS_QUICK === "1";
const report = await runRealNetworkHarness({
  clientCount: Number(process.env.HARNESS_CLIENTS ?? (quick ? 6 : 16)),
  propCount: Number(process.env.HARNESS_PROPS ?? 128),
  durationMs: Number(
    process.env.HARNESS_DURATION_MS ?? (quick ? 1_500 : 5_000),
  ),
});
await mkdir("reports/network", { recursive: true });
const path = `reports/network/protocol-v7-${report.clientCount}-${report.propCount}.json`;
await Bun.write(path, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ path, ...report }));

const blocking = process.env.HARNESS_NONBLOCKING !== "1";
const failures = blocking ? networkBudgetFailures(report) : [];
if (failures.length > 0)
  throw new Error(`network harness failed: ${failures.join(", ")}`);
