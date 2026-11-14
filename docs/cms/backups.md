# TeaCMS app-owned backups

TeaCMS alone owns this scheduler, retention and authenticated operator-dashboard
status. It does not back up or migrate the separate production Andrew site,
its legacy Strapi uploads, Auth or another app. No sidecar or Docker socket is used.
The implementation lives in `apps/cms/backup/`; the server starts it after opening
all configured tenant databases and waits for an active run on graceful shutdown.

## Configuration and storage

Backups are disabled unless `TEA_BACKUP_DIR` is explicitly configured. The local
Compose example mounts the distinct named `cms-backups` volume at `/app/backups`;
production may use a clearly named persistent bind at the same container path.
Keep it outside `/app/data`, static/public roots and the container writable layer.
Both mounts need UID1000 write access. Never use `docker compose down -v` as an
ordinary restart. An absent/unwritable mount is a visible backup failure, not proof
of protection; operators must verify the actual persistent mount.

<!-- prettier-ignore -->
| Variable | Default | Meaning |
| --- | --- | --- |
| `TEA_BACKUP_DIR` | unset | Explicit separate persistent backup root; enables scheduler |
| `TEA_BACKUP_INTERVAL_SECONDS` | 86400 | Minimum60; interval from latest verified snapshot start |
| `TEA_BACKUP_KEEP` | 7 | Retain latest seven completed daily generations, not new hourly/monthly tiers |
| `TEA_BACKUP_RESERVE_BYTES` | 268435456 | Minimum1MiB; free-space floor checked before database/file copies |
| `APP_REVISION` | unknown locally | Publisher embeds source commit in image and each manifest |

Initial/startup work is one coalesced due run, not one run per missed day. Subsequent
runs use the persisted verified catalogue, not filesystem mtime or an in-memory
success flag. Errors retry within five minutes (or the shorter configured interval).
A dedicated `.lease.sqlite` write transaction stays open throughout verification,
capture and pruning. Other app processes cannot acquire it; process death releases
the OS lock without TTL guessing or deleting stale lock files. Use local filesystems,
not NFS. Same-process calls coalesce. `status.json` is an atomic private receipt;
the authenticated operator dashboard displays running/last success/next due/error,
count/bytes/policy. Public health and login do not expose backup inventories.

## Contents and consistency contract

Each version1 `manifest.json` identifies the image/source revision, capture start,
independent database snapshots, file paths/sizes/SHA256, and consistency mode:

- Every registered site: `<id>/tea.db` including drafts, history, identities and
  settings; **all** `<id>/uploads` including unlisted/recoverable bytes; all
  `<id>/public` including direct legacy public URLs inside this CMS data tree.
- When enabled: `operator/operator.db`, including operator identity links and
  authentication state (restored sessions/tickets are invalidated).
- Configuration/manifests, canonical origins, sealed credentials and proxy routing
  remain deployment dependencies. Preserve their reviewed recovery copies separately;
  they are not silently bundled as secrets. The manifest records the source revision,
  not a copy of the container image.

Use SQLite online backup, including committed WAL, never copy a live `tea.db` alone.
Each database has its own consistent snapshot; the tenant/operator set is **not one
cross-database instant**. A backup spans an interval. For an exact whole-install
checkpoint, quiesce editors/external writers first. Operator/session invalidation
on restore removes reliance on cross-database live authentication timing.

The database is captured before that site\u0027s files. This relies on the existing
CMS invariant: successful uploads use new UUID files and unlisting retains bytes.
All bytes referenced by snapshot media rows must exist in the verified archive.
Copied file hashes are rechecked against sources; public-tree inventory must remain
stable, and symlinks/nonregular files are rejected. Concurrent append-only uploads
may appear as harmless extra files. No upload GC/overwrite may be introduced without
coordinating this capture protocol. External writers must not modify public/media
while a consistent capture is required. This is not a filesystem snapshot or a
promise of global point-in-time consistency under arbitrary external writes.

A private `.partial-*` directory is never a completed backup. Files/SQLite are
synced and reread/verified before atomic directory publication as `snapshot-*`.
After a valid new success, every owned generation is verified before pruning to
seven. Corruption blocks pruning. Unknown/manual/old `.tar.gz` archives and partial
directories are never automatically deleted. Report errors and investigate partial
storage manually; disk reserve checks fail closed rather than erasing the last good
backup. The floor is a guard, not a filesystem quota against concurrent host users.

## Restore and acceptance

With CMS stopped, use a supported Node26 runtime from the checked source/image:

```sh
node apps/cms/scripts/restore-backup.ts /private/backups/snapshot-... /private/new-cms-data
```

The destination must not exist. The command verifies version, paths, inventory,
hashes, SQLite integrity and media references before copying. It preserves IDs and
subject links, clears site/operator sessions and tickets, and writes a restore
receipt. A failed restore is left marked `RESTORE-FAILED.json`, never served or
silently deleted. Do not point it at live storage. Preserve current data, verify
origins/configuration/image compatibility, test all sites/operator/media with the
new directory, then coordinate one offline mount switch. Do not restore an old
snapshot over new writes or manufacture identity links. Existing saved archives
remain separate recovery authority; the new tool does not adopt or prune them.

Synthetic automated tests cover live-WAL snapshots for two sites plus operator,
public and retained media, offline restore and session invalidation, repeated startup,
exclusive lease, seven-generation retention, corrupt/missing files, disk reserve,
unsafe paths and disabled configuration. Production acceptance additionally requires
one actual completed snapshot and an **offline restore into a new private directory**
with byte/database verification; no human sign-in or production writes are needed.
Only then may Infra retire the **TeaCMS-only** host cron. Keep its good archives.
The standalone Andrew cron and legacy media protection remain untouched.

A second local volume on the same host is local recovery, **not disaster recovery**.
Off-host encrypted copies, independent failure domains, freshness alerts and recurring
restore drills still need an explicit policy. The app does not claim those exist.
