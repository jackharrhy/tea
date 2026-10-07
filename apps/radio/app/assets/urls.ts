export function getWsUrl(roomSlug: string): string {
  let { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/ws/${encodeURIComponent(roomSlug)}`;
}

export function getTrackCreateUrl(roomSlug: string): string {
  return `/api/rooms/${encodeURIComponent(roomSlug)}/tracks`;
}

export function getTrackContentUrl(roomSlug: string, trackId: string): string {
  return `/api/rooms/${encodeURIComponent(roomSlug)}/tracks/${encodeURIComponent(trackId)}/content`;
}
