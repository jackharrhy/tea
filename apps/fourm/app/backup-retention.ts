export interface BackupRetentionEntry {
  name: string;
  startedAt: number;
}
function isoWeek(input: Date) {
  const thursday = new Date(
    Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()),
  );
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  return Math.ceil(
    ((thursday.getTime() - Date.UTC(thursday.getUTCFullYear(), 0, 1)) /
      86400000 +
      1) /
      7,
  );
}
export function planBackupRetention(
  entries: readonly BackupRetentionEntry[],
  now = Date.now(),
  maximum = 48,
) {
  if (!Number.isFinite(now) || !Number.isSafeInteger(maximum) || maximum < 1)
    throw new RangeError("Invalid backup retention policy");
  const names = new Set<string>();
  for (const entry of entries) {
    if (
      !entry.name ||
      names.has(entry.name) ||
      !Number.isFinite(entry.startedAt) ||
      !Number.isFinite(new Date(entry.startedAt).getTime())
    )
      throw new TypeError("Invalid completed backup inventory");
    names.add(entry.name);
  }
  const ordered = entries.toSorted(
    (a, b) =>
      b.startedAt - a.startedAt ||
      (a.name < b.name ? 1 : a.name > b.name ? -1 : 0),
  );
  const buckets = new Set<string>(),
    keep: string[] = [],
    remove: string[] = [];
  for (const entry of ordered) {
    const age = (now - entry.startedAt) / 3600000,
      date = new Date(entry.startedAt);
    let bucket: string | null = null;
    if (age >= 24 && age < 24 * 7)
      bucket = "day-" + date.toISOString().slice(0, 10);
    else if (age >= 24 * 7 && age < 24 * 30)
      bucket = `week-${date.getUTCFullYear()}-W${String(isoWeek(date)).padStart(2, "0")}`;
    else if (age >= 24 * 30) bucket = "month-" + date.toISOString().slice(0, 7);
    if ((bucket === null || !buckets.has(bucket)) && keep.length < maximum)
      keep.push(entry.name);
    else remove.push(entry.name);
    if (bucket !== null) buckets.add(bucket);
  }
  return { keep, remove };
}
