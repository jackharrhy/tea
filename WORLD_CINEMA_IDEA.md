# World cinema room

This is a proposed room inside World, not a separate video-store application. A player who has explicit media access in Jack Auth can enter a small shop or cinema space, browse cases from a real media library, inspect a title, and choose to play it in Jellyfin. Other World players cannot enter or fetch its catalogue by default. Returning from playback should bring the player back to the same place.

This idea does not change the overview, room, and pool-table first slice in [WORLD_IDEA.md](WORLD_IDEA.md). Whether the cinema comes before or after that slice remains a product choice. Burger, Gurgur, Pool, and Worldview remain working products while World develops.

## Small experience to prove

- One authored room with a few shelves and a bounded selection of actual Jellyfin titles. Each case has a stable item ID and a useful inspect action with title, synopsis, artwork, and playback availability.
- A normal search and details view for eligible players, including keyboard and small-screen use. If the room renderer fails or is unavailable, the catalogue remains usable.
- Clear loading, empty, unavailable-library, missing-artwork, and expired-access states. Load artwork within a budget rather than fetching the whole library into the room.
- **Play** hands off to Jellyfin. World remembers the player's room and position so returning is coherent. Jellyfin may still require its own native account; Jack Auth admission to the room is not a Jellyfin sign-in or a promise of playback rights.

There is no need to simulate checkout, rental penalties, or currency. Shared presence, chat, and synchronized watching are optional later questions, not prerequisites for browsing a useful store.

## Admission and data boundaries

World can use Jack Auth for the player's immutable subject and an explicit media entitlement. The cinema door, its catalogue API, artwork access, and any room connection must all be checked server-side. A client-side hidden door is not an access control. A valid World login alone grants no cinema access, and missing, inactive, or unrecognized entitlement means denied. Access should be rechecked on new requests and connections, with bounded session lifetime and a defined revocation path.

The current Jack Auth media-access planner is a **preview only**: its UI states that reader accounts and per-service enforcement are not configured, and it applies no grants. The existing media-admin role and Rotund's service links therefore do not establish a reusable general media group. The Jack Auth owner needs to confirm whether World should receive its own cinema role or a reviewed media-access grant that is safely reusable across services. No membership, account link, provider client, or grant is created by this document.

Jellyfin remains the source of catalogue and playback truth. A small server-side catalogue adapter would fetch only the titles and fields the room needs, preserve Jellyfin item IDs, and avoid exposing a privileged library credential to the browser. The first experience should not copy video files or invent a second library database.

## Harrhy pieces

- Worldview's editor can author the room in Valve 220 format. Gurgur's compiler and player controller are promising for a physical interior, but their renderer, simulation, and network stack do not already form one World runtime. A case-to-catalogue-ID interaction and an authored-asset seam would be new.
- Pool offers proven canvas cleanup, input, reconnection, and presence lessons. Its fixed hall geometry, match authority, and table protocol should stay with Pool until a real World pool table needs them.
- Burger's overview and Atlas inform how a player finds and enters the cinema. Its Pixi world and saved data remain separate.
- Remix can own the ordinary catalogue, details, admission responses, and accessible fallback. `@harrhy/identity` provides Jack Auth verification primitives; World still owns its room policy and session state.

## Decisions left open

1. Does this room follow World's existing overview-room-pool slice, or become the first interior used to prove room entry and return?
2. Is the first cinema quiet personal browsing, or should seeing other eligible players be part of the initial experience?
3. Which reviewed Jack Auth entitlement admits the room, and how is it revoked? This needs an explicit contract with the Auth owner before implementation.
