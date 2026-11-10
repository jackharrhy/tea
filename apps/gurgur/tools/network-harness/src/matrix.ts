import { runRealNetworkHarness } from "./real-harness";
import { networkBudgetFailures } from "./release-budgets";

const quick = process.env.HARNESS_QUICK === "1";
const report = await runRealNetworkHarness({
  clientCount: quick ? 6 : 16,
  propCount: 128,
  durationMs: quick ? 1_500 : 5_000,
});
console.log(JSON.stringify(report));

const failures = networkBudgetFailures(report);
if (failures.length > 0)
  throw new Error(`network matrix failed: ${failures.join(", ")}`);
