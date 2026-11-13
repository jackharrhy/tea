import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  planBackupRetention,
  backupNameTime,
} from "../app/backup-retention.ts";
// Golden results generated from the original read-only Python oracle using only synthetic data.
// CI must not require a developer's production/oracle checkout or interpreter.
const goldens = JSON.parse(
  readFileSync(
    new URL("./fixtures/backup-retention-goldens.json", import.meta.url),
    "utf8",
  ),
);
function sourcePlan(now, names, maximum) {
  const reference = goldens.cases.find(
    (value) =>
      Date.parse(value.now) === now &&
      value.maximum === maximum &&
      JSON.stringify(value.names) === JSON.stringify(names),
  );
  expect(reference, "Missing original-oracle golden case").toBeDefined();
  return reference.keep;
}
function entry(time) {
  const date = new Date(time),
    stamp = date.toISOString();
  return {
    name: stamp.slice(0, 10) + "-" + stamp.slice(11, 19).replaceAll(":", ""),
    startedAt: date.getTime(),
  };
}
test.each(["2026-11-12T12:00:00Z", "2027-01-20T12:00:00Z"])(
  "matches original UTC daily/ISO-week/month retention at %s",
  (timestamp) => {
    const now = Date.parse(timestamp),
      entries = [];
    for (const hours of [
      0, 1, 23, 24, 25, 47, 48, 72, 144, 167, 168, 169, 192, 360, 456, 504, 719,
      720, 721, 744, 1440, 2160, 3000, 4000,
    ])
      entries.push(entry(now - hours * 3600000));
    const planned = planBackupRetention(entries, now);
    expect(planned.keep.toSorted()).toEqual(
      sourcePlan(
        now,
        entries.map((e) => e.name),
        48,
      ),
    );
    expect(new Set([...planned.keep, ...planned.remove]).size).toBe(
      entries.length,
    );
  },
);
test("matches the original 48-snapshot hard cap and never mutates the caller's list", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const entries = Array.from({ length: 72 }, (_, i) => entry(now - i * 60000));
  const original = structuredClone(entries);
  const planned = planBackupRetention(entries, now);
  expect(planned.keep).toHaveLength(48);
  expect(planned.keep.toSorted()).toEqual(
    sourcePlan(
      now,
      entries.map((e) => e.name),
      48,
    ),
  );
  expect(entries).toEqual(original);
});
test("rejects ambiguous inventory and a policy that would delete every snapshot", () => {
  const item = entry(Date.parse("2026-11-12T12:00:00Z"));
  expect(() => planBackupRetention([item, item])).toThrow(
    "Invalid completed backup inventory",
  );
  expect(() =>
    planBackupRetention([{ name: "invalid", startedAt: NaN }]),
  ).toThrow("Invalid completed backup inventory");
  expect(() => planBackupRetention([item], Date.now(), 0)).toThrow(
    "Invalid backup retention policy",
  );
});

test("reads canonical native job timestamps without guessing manually named snapshots", () => {
  const suffix = "-12345678-1234-4123-8123-123456789abc";
  expect(backupNameTime("2026-11-13T001234567Z" + suffix)).toBe(
    Date.parse("2026-11-13T00:12:34.567Z"),
  );
  expect(backupNameTime("2026-02-29T001234567Z" + suffix)).toBeNull();
  expect(backupNameTime("manual-preserve")).toBeNull();
  expect(backupNameTime("2026-11-13T001234567Z-not-a-uuid")).toBeNull();
});
