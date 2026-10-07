import type { EditorSession } from "@tea/maps-editor/core";
import type { EditorSourceRenderer } from "@tea/maps-editor/render";

export interface IssueBrowserOptions {
  readonly session: () => EditorSession;
  readonly renderer: () => EditorSourceRenderer | null;
  readonly canEdit: () => boolean;
  readonly prepareEdit: () => boolean;
  readonly status: (message: string) => void;
}

export interface IssueBrowserState {
  readonly options: IssueBrowserOptions;
  readonly resetRevision: number;
}

export function createIssueBrowser(options: IssueBrowserOptions) {
  let ready = false;
  let resetRevision = 0;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<IssueBrowserState>("tea-maps-issues-state", {
        detail: { options, resetRevision },
      }),
    );
  }

  window.addEventListener("tea-maps-issues-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-issues-bridge-ready"));

  return {
    refresh: publish,
    reset() {
      resetRevision++;
      publish();
    },
  };
}
