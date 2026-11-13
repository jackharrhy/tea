# Migration and recovery

The isolated candidate and Python oracle use the same sanitized production-content
snapshot. Production has not been changed or cut over. The Python service and its
retained first/current backups remain the production recovery authority. Do not
boot an old issuer or restore pre-retirement credential state.

## Offline source export

Take a consistent SQLite backup and a matching uploads snapshot through the
source owner's approved procedure. Work on those copies, with writes stopped or
otherwise excluded across both snapshots. From this app:

```sh
node scripts/export-source.mjs OFFLINE_SQLITE_COPY UPLOADS_COPY NEW_ARCHIVE_DIRECTORY
```

The exporter opens SQLite read-only, checks integrity and foreign keys, preserves
all 18 core tables and numeric IDs, and hashes every indexed media file. Explicit
issuer/subject links, local admin/disabled flags and content ownership survive.
Password hashes are blanked. Retired OAuth tables, reset credentials and browser
sessions are excluded. Keep the original source backup separately; this archive
is an application transfer, not a replacement for that backup.

Unindexed upload files are not transferred. Compare the source upload inventory
before a real migration and retain any unique files for an explicit disposition.
Do not infer identity from names or email. Existing users need fresh login.
Enrollment records retain their original identifiers and receipts: reconcile
pending delivery with the Auth owner before a future cutover, rather than
replaying historical enrollment or issuing grants blindly.

## Native backup and restore

```sh
FOURM_URL=https://candidate.example \
FOURM_ACCESS_TOKEN_FILE=/private/scoped-token \
node scripts/archive.mjs backup NEW_ARCHIVE_DIRECTORY

FOURM_URL=https://empty-candidate.example \
FOURM_ACCESS_TOKEN_FILE=/private/scoped-token \
node scripts/archive.mjs restore ARCHIVE_DIRECTORY
```

Backup requires local admin plus the explicit `archive-read` scope. Restore
requires an authenticated central admin with `archive-restore`; it can bootstrap
an empty community before a local identity exists. These archive permissions are
review-fixture contracts, not provisioned production grants. A real deployment
needs a separately reviewed resource/client contract. Keep bearer files private.

The tool checks all object hashes before uploading. Objects are staged before a
single metadata transaction; restore checks their sizes/checksums and foreign
keys. It refuses a populated unrelated community or conflicting object bytes.
An exact archive retry returns its durable receipt. Readback compares every
transferred field and media byte. Failed staging can leave unindexed objects;
retain the archive and reconcile those exact keys rather than wiping a bucket.

Native backup takes two metadata snapshots around object reads and refuses a
changed snapshot. For a reliable recovery point, stop candidate writes during
backup. For host-level recovery, stop the owned supervisor, verify its child
processes exited, then copy the whole private state directory, including
`objects.sqlite3` (the authority), configuration and issuer state. `replica/` is
rebuildable cache; copying it alone is not a backup. Never copy a live SQLite
file without a consistent SQLite backup/checkpoint procedure.

## Rollback boundary

Before a production cutover, keep Python running unchanged and discard only the
isolated candidate if review fails. No production rollback is needed today.
After any future native writes, returning to Python requires an audited reverse
transfer/reconciliation of those writes; restoring an older Python snapshot
would lose data. This branch does not implement that reverse importer. Retain
native authority, archives and source recovery points until that decision.

The cold-reopen test removes only its disposable replica, reopens from the
SQLite object authority, and then restores an archive into a second empty
authority. It never restores a live database or legacy credential state.
