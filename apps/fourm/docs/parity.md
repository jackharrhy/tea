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

## Verified so far

Paired desktop/mobile runs use the same imported member/content cohort. The home
card order and content, profile guestbook placement, guestbook entries, settings
sections, controls and saved values match the oracle. Actual browser workflows
cover CSS and guestbook styling save/reopen, notification preferences, playlist
add/move/remove, page create/edit/reopen/delete, and signing/deleting an entry
inside the profile's guestbook iframe without navigating the parent. These are
local review identities acting on copies, not production SSO.

The source's browser helpers and CodeMirror editor are built in this workspace.
HTMX is the same pinned version, served locally for the isolated comparison.
The five-minute chat badge uses the source's seeded choices. Raw profile metadata
is inserted before member scripts; simple/css-only layouts retain their original
composition. More real-content layout coverage is still required.

Run `npm run test:parity --workspace @harrhy/fourm` with the owned oracle and native
listeners running. `FOURM_PARITY_WRITES=1` includes the controlled local-copy edits
and restores existing values. Evidence stays outside Git in the private parity
root. The native readiness fingerprint must match both its supervisor receipt and
the current app sources; a stale worker cannot satisfy the comparison.

## Still required

Username/media relocation, full media serving and management, notifications and
watch behavior, source admin/export workflows, forum quotes/pagination, chat,
and every original widget rendering/configuration path remain implementation and
verification work. Source validation/error paths and JSON contracts need the same
care as positive browser flows. Recheck all real layouts and perform full
real-content authority reopen, import/replay and recovery before review readiness.
The earlier POC browser runner is not proof of the corrected workflow threshold.
