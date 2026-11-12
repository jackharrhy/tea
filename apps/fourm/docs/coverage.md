# Candidate coverage and boundaries

## Implemented

- Exact issuer/subject identity links, signed OIDC callback with state/nonce/S256,
  one-use transactions, host-only hashed browser sessions and local disabled checks.
- Profiles, trusted member HTML/CSS/JS, Markdown, public/private pages, canonical
  member page URLs and CLI-compatible page/media JSON APIs.
- Forum threads/replies, own-post editing, admin pin/lock/moderation; chat with
  persistent messages, bounded cursor batches, SSE reconnect and presence leases.
- Invite reservations, verified subject claims, trust agreement and committed new
  profiles with empty password hashes. Post-commit companion delivery uses durable
  CAS receipts, terminal outcomes and explicit blocked/retry states.
- Media ownership/quota reservations, R2 bytes, durable deletion cleanup; avatars,
  status, profile cards, guestbooks, counters, playlists, webring, feeds and lineage.
- Local admin disable/enable, preserving numeric IDs and ownership.
- Offline source export, native archive transfer, checksum/FK checks, idempotent
  restore, and cold reopen from object authority after replica-cache removal.

The tests use a signed disposable provider, not production accounts or grant
writes. The released Go CLI exercises real scoped API calls. Its interactive
login intentionally pins the production issuer: a new login against this fake
issuer is not claimed or enabled. Production central integration still needs its
own approved client/callback/resource wiring and acceptance.

## Known gaps before production parity

Username changes and media relocation, push dispatch/device preferences,
thread-watch/notification UI, per-user ZIP export and the full legacy admin
maintenance screens are not ported. Stored columns remain in the core archive.
Forum quote snapshots are preserved but the quote editor/display parity and
pagination are unfinished. Python Markdown attribute-list extensions are not
implemented. Widget custom HTML/CSS and theme fields are preserved but not all
original settings/render paths are exposed. Default/simple layouts share the
candidate chrome; raw/css-only pages retain their distinct rendering behavior.
Media HTTP Range requests are not implemented. Playlist ownership/order has model
coverage; audio playback has not been exercised in a browser.

Visitor cooldown uses an opaque per-browser token rather than source IP. Guestbook
text over 500 characters is rejected rather than silently truncated. These are
visible differences to review. The UI follows 4orm's existing cyan/plain HTML
style; exact source visual parity is not claimed.

## Shared Celld proof

One Celld 0.6.2 instance hosts three deployed workers: 4orm, a public-directory
peer, and a review gateway. Only 4orm owns its SQLite Durable Object and R2.
The peer receives only `CommunityPublicDirectory.listPublicMembers`, excluding
local IDs, roles, private content and sessions. The gateway strips cookies and
Authorization before forwarding public-directory requests. Peer writes fail.

The host/operator and gateway remain trusted. This is explicit application
capability separation, not a claim of hostile-tenant host isolation. Private
variables live in each deployment manifest; global `CELLD_VAR_*` overrides would
apply to co-hosted workers and must not be used for app secrets.

Future world interactions can consume public cards through this capability.
Private interactions need a separate opted-in binding and actor/permission
contract; shared runtime does not share roles or identity authority. No 3D product,
other app migration, production deployment, or domain decision is included.
The proposed `harry.xyz` spelling remains unresolved against `harrhy.xyz`;
Rotund and existing domains are unchanged.
