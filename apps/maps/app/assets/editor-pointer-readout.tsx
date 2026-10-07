import type { EditorPointerPositionEvent } from "@tea/maps-editor/render";
import { clientEntry, type Handle } from "remix/component";

export const EditorPointerReadout = clientEntry(
  `${import.meta.url}#EditorPointerReadout`,
  function EditorPointerReadoutComponent(handle: Handle) {
    let pointer: EditorPointerPositionEvent | null = null;
    let pending: EditorPointerPositionEvent | null = null;
    let frame = 0;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-pointer-position",
        (event) => {
          pending = (event as CustomEvent<EditorPointerPositionEvent | null>)
            .detail;
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            pointer = pending;
            handle.update();
          });
        },
        { signal: handle.signal },
      );
      handle.signal.addEventListener(
        "abort",
        () => {
          if (frame) cancelAnimationFrame(frame);
        },
        { once: true },
      );
    });

    return () => (
      <output id="pointer-context" aria-label="Map pointer position">
        {pointer
          ? `${pointer.viewport.toUpperCase()} · ${pointer.point.map((value) => Math.round(value)).join(", ")}`
          : "Map pointer —"}
      </output>
    );
  },
);
