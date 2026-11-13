# Candidate coverage and boundaries

This is a migration of the existing Python application, using the Python app as
an implementation oracle and the same private content in both runtimes. It is
available for work-in-progress human review; whole-migration acceptance is open.

## Working services

- Server-rendered documents and fragments through Remix 3, with HTMX and small
  browser enhancements. Core content does not require SPA hydration.
- Original home cards, profiles, pages, customization, embedded guestbook,
  expandable settings, CodeMirror editors and widget configuration.
- Media upload/quick-upload, preview, rename, alt text, deletion, quotas and
  ownership; durable username/media relocation with interrupted-operation recovery.
  Serving includes HEAD, ranges, conditional requests and original MIME metadata.
- Forum threads, posting, quotes, pagination, editing, watch preferences and
  moderation controls; public chat history, SSE, presence and reconnect behavior.
- Source admin forms, account controls, invite/trust completion, explicit identity
  links and durable post-profile companion-membership receipts. A real-cohort
  loopback HTTPS fixture verifies signup, trust acceptance, member-only completion
  and retries that do not recreate deleted grants.
- Member/full-site ZIP exports, portable archive transfer and native backup
  capture/restore, catalogue reconstruction and retention. Actual recurring
  alarms captured the imported cohort, followed by cold restore of all 30 managed
  tables and 146 assets. A SQLite/R2-adapter integration test also covers a
  rename captured after a lost write acknowledgment, restored and resumed without
  recopying the destination. Scheduling remains disabled by default.
- Released Go CLI: actual browser sign-in, signed callback, native profile/page/
  media operations, automatic refresh after a 401, refresh replay rejection and
  immediate revocation. This uses a caged disposable provider, not production SSO.

Browser evidence covers selected desktop/mobile workflows, including save/reopen,
embedded guestbook placement, forum/chat activity and cold persistence. It does
not prove every account, customization or error path.

The corrected private cohort contains 62 members, 22 pages and 146 media assets.
All 18 transfer tables and media bytes/metadata have been checked, with explicit
local fixture aliases accounted for separately. Native recovery also preserves
operational state. Test copies and the human-review instance have separate state;
new review activity must not be overwritten by reseeding.

## Open work

- Actual native Web Push delivery: device/preference flows work, but Celld 0.6.2
  has incompatible raw P-256 key import/export. ECDH with SPKI/PKCS#8, AES-GCM
  and VAPID signing pass isolated probes; end-to-end native push does not. VAPID keys
  remain unset; no successful native notification delivery is claimed.
- Counter visitor identity still uses a browser token rather than source-IP
  cooldown semantics. Trusted peer attribution remains unresolved.
- Remaining dashboard scenarios,
  moderation/validation edges and complex-list and malformed Markdown attributes.
  Common heading, paragraph, inline, table-cell, tight-list and fenced-code attributes are
  implemented and
  worktree-tested; they have not been rolled into the active human preview.
- Broader customization/layout review and the reported initial-paint/pop-in issue.
  Core SSR is verified; separately painted iframes and client enhancements remain.

The private preview gates both the app and fixture issuer, restricts outbound
browser resources, and remaps hardcoded production asset URLs to its own copied
assets. It serves a fixed gifenc library locally for the lettering page. Those
are preview transport accommodations, not changes to saved member content or a
complete solution for arbitrary external dependencies in a future deployment.

## Scope

One Celld instance hosts 4orm plus a synthetic public-directory peer and review
gateway. These helpers are not migrated Harrhy applications. Only 4orm owns its
DO/R2; the peer has a narrow directory capability and receives no user credentials.
This proves capability separation, not hostile-tenant isolation.

Authentication is isolated fixture authentication. Production Python/Auth,
domains and the Harrhy owner's checkout remain untouched. No publication,
integration merge or production cutover is claimed. The old POC listener was
replaced after Jack explicitly waived preservation of its disposable review data.
