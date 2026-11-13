# Faithful migration review

The existing Python product is the implementation oracle. The native candidate
uses the same private production-content cohort: 62 members, 22 pages and 146
media assets. It preserves original IDs, ownership, customization and explicit
identity links. The Tailnet preview now serves that real-content copy behind
private access; it no longer serves the original synthetic POC.

Production is untouched. Authentication uses a declared isolated fixture alias,
not production SSO. Passwords, tokens, browser sessions, push endpoints, mail
credentials and unconsumed enrollment jobs are excluded. Completed enrollment
history is retained. No publication, integration merge or cutover is authorized.

## Verified scope

Paired desktop/mobile browser workflows cover original home cards, profiles,
embedded guestbook, settings save/reopen, widgets/playlists, pages, media,
forum/chat and selected admin workflows. The guestbook remains in the original
profile/widget context. Source CSS, browser helpers, HTMX and CodeMirror are
served locally. These are bounded workflow checks, not every customization or
error path. `coverage.md` records current limitations.

The corrected pair passed field-for-field accounting of all 18 transfer tables
and all 146 media assets, including MIME, validators and modification times.
Native scheduled capture and cold restore preserved 30 managed tables and those
assets. Interrupted username relocation resumes after authority restore, retaining
IDs and bytes. The released Go CLI passed actual browser login and native API,
refresh and revocation flows with a caged fixture issuer.

The private preview remaps hardcoded production asset origins and serves the
lettering page's fixed gifenc dependency locally. Saved member content remains
unchanged. Those transport accommodations do not establish support for every
external dependency in a future deployment.

## Counter ingress

The preview proxy signs source-IP counter context using a dedicated private key.
The Worker verifies its signature, request method/path and freshness before
hashing the IP for the original per-member cooldown. Raw forwarding headers and
browser cookies cannot substitute for that proof. The proxy strips any supplied
proof header and takes the IP only from the trusted Tailnet Serve boundary.

`COUNTER_PEER_KEY` configures verification in the Worker. The private runner reads
it from `FOURM_REVIEW_COUNTER_PEER_KEY_FILE`; the proxy reads the same dedicated
file through `counterPeerKeyFile`. Do not reuse enrollment, identity or review
access keys. Configured Workers fail closed on missing/invalid proof. Unconfigured
local fixtures retain cookie attribution, which is not source-IP parity. A future
Harrhy ingress must wire a trusted signer before claiming that parity. Never
expose an unsigned backend as the public counter ingress.

## Review and remaining work

The current Tailnet copy retains Jack's review activity. Do not reseed it or copy
large cohorts for routine checks. Private source snapshots, runtime state and
browser evidence stay outside Git. Existing paired runners operate on their
owned test copies, not the human-review store.

Native Web Push remains blocked by Celld 0.6.2 raw P-256 import/export behavior;
SPKI/PKCS#8 ECDH, AES-GCM and VAPID primitives work, but native delivery does not.
VAPID keys remain unset. No notification success is claimed. Broader layout and
moderation/validation review remains bounded by actual gaps or user reports.

`npm run test:parity --workspace @harrhy/fourm` requires its configured owned
oracle/native listeners. `FOURM_PARITY_WRITES=1` edits only those disposable test
copies and restores existing values. Match the running source fingerprint before
using results. Do not treat an old runner or synthetic POC receipt as current
whole-migration acceptance.
