import type { HarnessReport } from "./real-harness";

export function networkBudgetFailures(report: HarnessReport): string[] {
  const failures = [...report.correctnessErrors];
  const local = report.profiles.local!;
  const typical = report.profiles.typical!;
  const adverse = report.profiles.adverse!;
  if (typical.stateAgeP95Ms >= 200) failures.push("Typical state age");
  if (adverse.stateAgeP95Ms >= 300) failures.push("Adverse state age");
  if (typical.presentationPathErrorP95Cm >= 2)
    failures.push("Typical presentation path error");
  if (adverse.presentationPathErrorP95Cm >= 5)
    failures.push("Adverse presentation path error");
  if (typical.bufferUnderrunPercent >= 0.1)
    failures.push("Typical presentation underrun");
  if (adverse.bufferUnderrunPercent >= 1)
    failures.push("Adverse presentation underrun");
  if (local.advancingFramePercent < 95) failures.push("Local banding");
  if (typical.advancingFramePercent < 95) failures.push("Typical banding");
  for (const [name, profile] of Object.entries(report.profiles))
    if (profile.averageBitsPerSecondPerRecipient >= 2_000_000)
      failures.push(`${name} recipient traffic`);
  if (
    Object.values(report.profiles).some(
      (profile) => profile.staleAuthorityAccepted !== 0,
    )
  )
    failures.push("stale authority accepted");
  if (report.server.tickP95Ms >= 8) failures.push("host p95");
  if (report.server.tickP99Ms >= 12) failures.push("host p99");
  if (report.server.discardedOverloadSeconds !== 0)
    failures.push("host discarded fixed-step time");
  return failures;
}
