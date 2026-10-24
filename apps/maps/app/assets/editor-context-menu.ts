export interface ContextAction {
  readonly label: string;
  readonly disabled?: boolean;
  run(): unknown;
}

export interface ContextSection {
  readonly label: string;
  readonly actions: readonly ContextAction[];
}

interface EditorContextMenuState {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly sections: readonly ContextSection[];
}

export interface EditorContextMenuContext {
  readonly state: EditorContextMenuState;
  readonly hide: (restoreFocus?: boolean) => void;
  readonly runAction: (action: ContextAction) => void;
}

export function createEditorContextMenu(report: (error: unknown) => void) {
  let state: EditorContextMenuState = {
    visible: false,
    x: 0,
    y: 0,
    sections: [],
  };
  let focusTarget: HTMLElement | null = null;
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorContextMenuContext>("tea-maps-context-menu-state", {
        detail: { state, hide, runAction },
      }),
    );
  }

  function hide(restoreFocus = false) {
    if (!state.visible) return;
    state = { ...state, visible: false, sections: [] };
    publish();
    if (restoreFocus) focusTarget?.focus({ preventScroll: true });
    focusTarget = null;
  }

  function runAction(action: ContextAction) {
    hide(true);
    void Promise.resolve()
      .then(() => action.run())
      .catch(report);
  }

  function show(
    x: number,
    y: number,
    sections: readonly ContextSection[],
    returnFocus: HTMLElement | null,
  ) {
    hide();
    focusTarget = returnFocus;
    state = {
      visible: true,
      x,
      y,
      sections: sections.filter((section) => section.actions.length > 0),
    };
    publish();
  }

  window.addEventListener("tea-maps-context-menu-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-context-menu-bridge-ready"));

  return { show, hide };
}
