export const DEFAULT_ROOM_SLUG = "cozy";

export function normalizeRoomName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function normalizeRoomSlug(value: string): string | null {
  let slug = value.normalize("NFKC").trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug) ? slug : null;
}

export function roomPath(roomSlug: string): string {
  return `/rooms/${encodeURIComponent(roomSlug)}`;
}

export function roomApiPath(roomSlug: string): string {
  return `/api/rooms/${encodeURIComponent(roomSlug)}`;
}
