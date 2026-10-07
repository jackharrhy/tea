import type {
  CollaborationPresence,
  HostedMapLaunch,
} from "@tea/maps-protocol";

export function hostedShareUrl(mapId: string, origin: string): string {
  const url = new URL("/editor", origin);
  url.searchParams.set("hostedMap", mapId);
  return url.toString();
}

interface VisibleParticipant {
  readonly actorId: string;
  readonly displayName: string;
  readonly viewport: string;
  readonly selectedCount: number;
  readonly editing: boolean;
}

export interface HostedPresenceState {
  readonly mapId: string;
  readonly displayName: string;
  readonly participants: readonly VisibleParticipant[];
}

const changeEvent = "tea-maps-hosted-presence-change";
const statusEvent = "tea-maps-hosted-presence-status";
type PresenceWindow = Window & {
  teaMapsHostedPresence?: HostedPresenceState | null;
};

export function currentHostedPresence(): HostedPresenceState | null {
  return (window as PresenceWindow).teaMapsHostedPresence ?? null;
}

export function onHostedPresenceChange(
  listener: () => void,
  signal: AbortSignal,
): void {
  window.addEventListener(changeEvent, listener, { signal });
}

export function reportHostedPresenceStatus(message: string): void {
  window.dispatchEvent(new CustomEvent(statusEvent, { detail: message }));
}

export function initHostedPresence(status: (message: string) => void) {
  let lastVisibleState = "";
  window.addEventListener(statusEvent, (event) => {
    status((event as CustomEvent<string>).detail);
  });

  return {
    update(
      map: HostedMapLaunch | null,
      participants: readonly CollaborationPresence[],
    ) {
      const state: HostedPresenceState | null = map
        ? {
            mapId: map.id,
            displayName: map.displayName,
            participants: participants.map((participant) => ({
              actorId: participant.actorId,
              displayName: participant.displayName ?? participant.actorId,
              viewport: participant.viewport ?? "No viewport",
              selectedCount: participant.selectedObjectIds?.length ?? 0,
              editing: !!participant.preview,
            })),
          }
        : null;
      const visibleState = JSON.stringify(state);
      if (visibleState === lastVisibleState) return;
      lastVisibleState = visibleState;
      (window as PresenceWindow).teaMapsHostedPresence = state;
      window.dispatchEvent(new Event(changeEvent));
    },
  };
}
