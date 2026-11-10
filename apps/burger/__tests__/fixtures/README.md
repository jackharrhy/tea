# Burger migration fixture

`burger.sqlite` is a synthetic source-schema database prepared for the Tea migration. It has two made-up central subjects and Burger local user IDs, two test sessions, one tile/edit, a palette and a zone membership. It contains no provider credentials or production content. The browser check refreshes the sessions' expiry in a temporary copy and verifies that the original user/content rows survive gameplay and restart.

Source handoff: `/home/jack/.local/state/world-tea-migration/burger/handoff.json`; fixture SHA-256 `081e784cd89377e32d83c03b1bdd4a023e76378b00f10431b38cdc265246fb42`. Do not run the production server against this checked-in fixture or write it in place.
