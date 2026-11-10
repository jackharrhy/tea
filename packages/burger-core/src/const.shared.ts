export const SERVER_TICK_RATE_MS = 1000 / 60;
export const CLIENT_UPDATE_RATE = 1000 / 60;

export const PLAYER_SPEED = 0.2;
export const ACCELERATION = 0.012;
export const FRICTION = 0.015;
export const TILE_SIZE = 32;
export const PLAYER_SIZE = TILE_SIZE - 8;

export const MESSAGE_TYPES = {
  SNAPSHOT: 0,
  OBSERVER: 1,
  YOUR_EID: 3,
  INPUT: 4,
  GAME_STATE: 5,
  PING: 6,
  PONG: 7,
  PAINT: 8,
  // SoA payload accompanies OBSERVER deltas: the observer carries
  // entity/component add/remove events but no field data, so we follow up
  // with a SoA payload that fills in the values for entities the observer
  // just announced. Used for static entities (tiles) where field data
  // doesn't otherwise stream via GAME_STATE.
  SOA: 9,
  // Broadcast when an admin saves or renames a catalog entry. Payload is
  // the new catalog as a JSON array (same shape as GET /api/catalog).
  // Clients refetch and update their local atlas + editor + world.catalog.
  CATALOG_UPDATED: 10,
  // Broadcast (admins only) after any successful zone mutation. Payload is
  // empty — admin clients refetch /api/zones + /api/zones/all-cells.
  ZONES_UPDATED: 11,
  // Sent to a single non-admin user after a mutation affects their
  // membership or the cells of zones they belong to. Payload is JSON:
  // { cells: [[x, y], ...] } — the union of paintable cells for that user.
  MY_ZONES: 12,
} as const;

export const TILE_TYPES = {
  FLOOR: 0,
  WALL: 1,
  COUNTER: 2,
} as const;

export type TileType = (typeof TILE_TYPES)[keyof typeof TILE_TYPES];

export const PROTOCOL_VERSION = 1;
export const MAX_INPUTS_PER_TICK = 8;
export const MAX_PAINTS_PER_TICK = 4;

// Upper clamp for client-supplied input dt (ms). Caps how much motion a
// single input can produce so a malicious client can't speed-hack by
// sending huge msec values. Twice the server tick is a generous ceiling
// for legitimate clients (e.g. on a temporary stutter) while still
// constraining motion per input to roughly 2x normal.
export const MAX_INPUT_MSEC = 2 * SERVER_TICK_RATE_MS;
