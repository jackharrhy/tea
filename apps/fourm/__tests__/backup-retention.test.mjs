import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  planBackupRetention,
  backupNameTime,
} from "../app/backup-retention.ts";
function sourcePlan(now, names, maximum) {
  const source = `import importlib.util,json,pathlib,tempfile,datetime,sys
spec=importlib.util.spec_from_file_location('fourm_backup_oracle','/home/jack/repos/personal/4orm/app/backup.py')
backup=importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
value=json.load(sys.stdin)
class Clock(datetime.datetime):
 @classmethod
 def now(cls,tz=None):
  return datetime.datetime.fromisoformat(value['now']).astimezone(tz)
backup.datetime=Clock
with tempfile.TemporaryDirectory(prefix='fourm-retention-oracle-') as directory:
 root=pathlib.Path(directory)
 for name in value['names']:(root/name).mkdir()
 backup.prune_old_backups(root,value['maximum'])
 print(json.dumps(sorted(path.name for path in root.iterdir())))
`;
  const result = spawnSync(
    "/home/jack/repos/personal/4orm/.venv/bin/python",
    ["-B", "-c", source],
    {
      input: JSON.stringify({
        now: new Date(now).toISOString(),
        names,
        maximum,
      }),
      encoding: "utf8",
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
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
