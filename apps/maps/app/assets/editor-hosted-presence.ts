import type {
  CollaborationPresence,
  HostedMapLaunch,
} from "@tea/maps-protocol";

export function hostedShareUrl(mapId: string, origin: string): string {
  const url = new URL("/editor", origin);
  url.searchParams.set("hostedMap", mapId);
  return url.toString();
}

export function initHostedPresence(status: (message: string) => void) {
  const share = document.querySelector<HTMLElement>("#hosted-share")!;
  const link = document.querySelector<HTMLInputElement>("#hosted-share-link")!;
  const copy = document.querySelector<HTMLButtonElement>("#hosted-copy-link")!;
  const summary = document.querySelector<HTMLElement>("#hosted-participants")!;
  const list = document.querySelector<HTMLUListElement>(
    "#hosted-participant-list",
  )!;

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link.value);
      status("Hosted map link copied");
    } catch {
      link.focus();
      link.select();
      status("Select the share link to copy it");
    }
  });

  return {
    update(
      map: HostedMapLaunch | null,
      participants: readonly CollaborationPresence[],
    ) {
      share.hidden = !map;
      link.value = map ? hostedShareUrl(map.id, location.origin) : "";
      copy.disabled = !map;
      list.replaceChildren();
      if (!map) {
        summary.textContent = "";
        return;
      }
      summary.textContent = `${participants.length + 1} ${participants.length === 0 ? "person" : "people"} here`;
      const local = document.createElement("li");
      local.textContent = `${map.displayName} (you)`;
      list.append(local);
      for (const participant of participants) {
        const item = document.createElement("li");
        const selected = participant.selectedObjectIds?.length ?? 0;
        item.textContent = [
          participant.displayName ?? participant.actorId,
          participant.viewport ?? "No viewport",
          selected ? `${selected} selected` : "No selection",
          ...(participant.preview ? ["Editing"] : []),
        ].join(" · ");
        list.append(item);
      }
    },
  };
}
