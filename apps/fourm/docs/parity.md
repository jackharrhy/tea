# Faithful migration rework

The Python product is the implementation oracle. The original fixture candidate
was not accepted as faithful parity. `coverage.md` lists unfinished implementation
work, not accepted exclusions. No production migration is authorized.

The first corrected pass restores the original shell stylesheet, original profile
panels/custom-content placement, and guestbook's bare iframe document with saved
owner CSS/HTML. It does not add guestbook/navigation widgets to members' pages.
The large-page storage adaptation preserves an existing 2.75 MB page without
increasing Celld's SQLite limits: bounded Unicode-safe chunks reassemble into the
original content field on read, edit and archive export.

Private state and evidence belong outside Git. The source-owned hourly backup
provides the cohort. `scripts/parity/snapshot.py BACKUP_DIRECTORY NEW_PRIVATE_DIR`
opens its SQLite read-only, builds a separate credential-free database, copies
indexed media bytes rather than shared hardlinks, and records counts/checksums.
It blanks passwords, replaces invite codes, and excludes retired credentials,
push endpoints and live enrollment jobs. Do not use the original raw database as
a writable app mount. Keep the original links and content untouched in that copy.

A separately declared review-only identity alias may be added to a second private
copy for signed local-provider testing. It is not production SSO or a production
identity change. Preserve original issuer/subject rows and account for the alias
separately. The Python oracle uses its own private code/database copy, no real
credentials, disabled backup scheduler and loopback-only server egress.

The current real-content native store is loopback-only. Existing Tailnet preview
still contains the older fixture cohort; it must not be called corrected review
readiness. Before replacing it, preserve user-added review data, finish parity,
and protect all real-content preview requests (including media) behind explicit
private review access. Do not expose imported member content anonymously.

Remaining work includes same-content comparisons and faithful home/settings,
forum/chat, themes/widgets, notifications/preferences, media/admin/export and
CLI workflows; original HTMX interactions, ordering, date formatting and recovery
must be verified against the running oracle, not inferred from unit test counts.
