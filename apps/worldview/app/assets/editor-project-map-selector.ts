import type { ProjectMap } from "./editor-project.ts";

export interface ProjectMapSelectorState {
  readonly projectName: string;
  readonly paths: readonly string[];
  readonly lastPath: string | null;
}

const changeEvent = "tea-maps-project-map-selector-change";
export const openProjectMapEvent = "tea-maps-project-map-selector-open";
export const syncProjectMapsEvent = "tea-maps-project-map-selector-sync";

type SelectorWindow = Window & {
  teaMapsProjectMapSelector?: ProjectMapSelectorState | null;
};

export function currentProjectMapSelector(): ProjectMapSelectorState | null {
  return (window as SelectorWindow).teaMapsProjectMapSelector ?? null;
}

export function onProjectMapSelectorChange(
  listener: () => void,
  signal: AbortSignal,
): void {
  window.addEventListener(changeEvent, listener, { signal });
}

export function initProjectMapSelector(options: {
  openMap(path: string): void;
  openSync(): void;
}) {
  window.addEventListener(openProjectMapEvent, (event) => {
    options.openMap((event as CustomEvent<string>).detail);
  });
  window.addEventListener(syncProjectMapsEvent, options.openSync);

  return {
    show(
      projectName: string,
      projectMaps: readonly ProjectMap[],
      lastMapPath?: string,
    ) {
      (window as SelectorWindow).teaMapsProjectMapSelector = {
        projectName,
        paths: projectMaps.map((map) => map.path),
        lastPath: lastMapPath ?? null,
      };
      window.dispatchEvent(new Event(changeEvent));
    },
    hide() {
      (window as SelectorWindow).teaMapsProjectMapSelector = null;
      window.dispatchEvent(new Event(changeEvent));
    },
  };
}
