export type SelectionBrushMode = "touching" | "inside" | "inside-projected";
export type SelectionBrushProjection = "xy" | "xz" | "yz";

export interface EditorSelectionBrushesContext {
  readonly enabled: boolean;
  readonly run: (
    mode: SelectionBrushMode,
    projection?: SelectionBrushProjection,
  ) => void;
}

export function initEditorSelectionBrushes(
  run: EditorSelectionBrushesContext["run"],
) {
  let enabled = false;
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorSelectionBrushesContext>(
        "tea-maps-selection-brushes-state",
        { detail: { enabled, run } },
      ),
    );
  }

  window.addEventListener("tea-maps-selection-brushes-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-selection-brushes-bridge-ready"));

  return {
    setEnabled(value: boolean) {
      if (enabled === value) return;
      enabled = value;
      publish();
    },
  };
}
