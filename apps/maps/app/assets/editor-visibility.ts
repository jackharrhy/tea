import type { EditorSession, EntityLinkMode } from "@tea/maps-editor/core";
import type { EditorSourceRenderer } from "@tea/maps-editor/render";

export interface EditorVisibilityState {
  readonly session: () => EditorSession;
  readonly mode: EntityLinkMode;
  readonly setLinkMode: (mode: EntityLinkMode) => void;
}

export function createEditorVisibility(options: {
  readonly session: () => EditorSession;
  readonly renderer: () => EditorSourceRenderer | null;
}) {
  let mode: EntityLinkMode = "direct";
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorVisibilityState>("tea-maps-visibility-state", {
        detail: {
          session: options.session,
          mode,
          setLinkMode(next) {
            mode = next;
            options.renderer()?.setEntityLinkMode(next);
            publish();
          },
        },
      }),
    );
  }

  window.addEventListener("tea-maps-visibility-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-visibility-bridge-ready"));

  return {
    refresh: publish,
    applyRenderer() {
      options.renderer()?.setEntityLinkMode(mode);
    },
  };
}
