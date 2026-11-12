# Candidate coverage and boundaries

The fixture POC is superseded by the faithful-parity pass. Python is the oracle;
unported behavior below is implementation work, not an accepted exclusion.
See [the private comparison workflow](parity.md).

## Implemented

- Exact issuer/subject links, signed OIDC state/nonce/S256, one-use transactions,
  hashed browser sessions and authoritative local disabled/admin checks.
- Original home cards, profile/page layouts, customization placement, expandable
  settings, CodeMirror helpers and the guestbook in its stored iframe context.
- Canonical page management, playlist ordering, widget preferences and original
  home/settings JSON contracts.
- Original media library, filename/extension/collision behavior, previews,
  upload/quick-upload, rename, alt text, delete, quotas and ownership checks.
- Durable username/media relocation: copies precede an atomic metadata commit;
  old paths remain reserved until cleanup, with alarm recovery after restart.
  Upload markers prevent abandoned-upload cleanup deleting unrelated R2 objects.
- Media ranges, HEAD, conditional requests and streaming delivery. Celld uses
  chunked framing for GET; HEAD retains representation length. Filename MIME types
  match the production Python registry. Archives preserve filesystem times, ETags
  and nanosecond timestamps through restore and cold reopen.
- Original forum index table, pin/lock indicators, reply dates and 25-thread
  pagination, with matching HTML composition and JSON responses.
- Forum/chat and local admin primitives, invite/trust/profile completion and
  durable post-commit companion-delivery receipts.
- Core content/identity archive transfer, checksums, FK validation and replay;
  the earlier POC proves authority reopen/cache removal and isolated restore.

Paired desktop/mobile checks use the same private real-content cohort. Current
coverage includes home/profile/guestbook/settings/media composition, settings
save/reopen, playlist/page operations, media management and username relocation.
Actual interrupted relocation recovered after cold start, followed by verification
of all original asset hashes. Full final recovery acceptance remains outstanding.

All authentication uses explicitly isolated review identities, not production SSO.
Released CLI API smoke is separate from interactive CLI login: the released login
pins the real issuer, so a fake-provider sign-in is not claimed as CLI acceptance.

## Still required

- Notifications/devices/push, thread watching, original forum/chat composition,
  quotes, pagination, and Python Markdown attribute-list behavior.
- Original counter/status/player/webring renderers and remaining widget workflows;
  the visitor cooldown still uses a browser token instead of source IP.
- Full admin maintenance and per-member ZIP export.
- More real-content layout coverage, complete row/field/exclusion accounting,
  adoption of the corrected final snapshot, final end-to-end recovery and
  released CLI-contract verification.
- Preserve the old preview's review data and add explicit private access protection
  before exposing the real-content cohort through the existing Tailnet routes.

## Shared Celld proof

One Celld instance hosts 4orm and two synthetic helpers: a public-directory peer
and a review gateway. They are not migrated Harrhy apps. Only 4orm owns its DO/R2;
the peer receives a narrow public directory, and the gateway strips credentials
before forwarding to it. This proves application capability separation, not
hostile-tenant isolation. Private variables must not use global overrides.

Production Python/Auth, domains and the Harrhy owner's checkout remain untouched.
Broader world integration and domain choices remain outside this candidate.
