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
  readonly color: string | null;
  readonly viewport: string;
  readonly selectedCount: number;
  readonly editing: boolean;
}

function viewportLabel(viewport: CollaborationPresence["viewport"]): string {
  switch (viewport) {
    case "xy":
      return "Top";
    case "xz":
      return "Front";
    case "yz":
      return "Side";
    case "perspective":
      return "3D";
    default:
      return "Idle";
  }
}

export interface HostedPresenceState {
  readonly mapId: string;
  readonly displayName: string;
  readonly connection: "viewing" | "connecting" | "connected" | "disconnected";
  readonly participants: readonly VisibleParticipant[];
}

const changeEvent = "tea-maps-hosted-presence-change";
const statusEvent = "tea-maps-hosted-presence-status";
const localCopyEvent = "tea-maps-hosted-local-copy";
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

export function requestHostedLocalCopy(): void {
  window.dispatchEvent(new Event(localCopyEvent));
}

export function initHostedPresence(
  status: (message: string) => void,
  makeLocalCopy: () => Promise<void>,
) {
  let lastVisibleState = "";
  window.addEventListener(statusEvent, (event) => {
    status((event as CustomEvent<string>).detail);
  });
  window.addEventListener(localCopyEvent, () => {
    void makeLocalCopy().catch((error: unknown) => {
      status(error instanceof Error ? error.message : String(error));
    });
  });

  return {
    update(
      map: HostedMapLaunch | null,
      participants: readonly CollaborationPresence[],
      connection: HostedPresenceState["connection"] | null,
    ) {
      const state: HostedPresenceState | null = map
        ? {
            mapId: map.id,
            displayName: map.displayName,
            connection: connection ?? "viewing",
            participants: (connection === "connected" ? participants : []).map(
              (participant) => ({
                actorId: participant.actorId,
                displayName: participant.displayName ?? participant.actorId,
                color: participant.color ?? null,
                viewport: viewportLabel(participant.viewport),
                selectedCount: participant.selectedObjectIds?.length ?? 0,
                editing: !!participant.preview,
              }),
            ),
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
