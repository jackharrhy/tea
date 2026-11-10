import { css, on, ref, type Handle, type RemixNode } from "remix/component";
import { useGameStore, type WindowState } from "../store";

const frame = css({
  position: "fixed",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  minWidth: "200px",
  minHeight: "56px",
  background: "#1a1a1ae6",
  color: "#fff",
  border: "1px solid #444",
  borderRadius: "6px",
  boxShadow: "0 8px 24px #0008",
  backdropFilter: "blur(4px)",
  font: "12px/1.4 monospace",
});
const titlebar = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: "0",
  height: "28px",
  padding: "0 4px 0 12px",
  background: "#2a2a2a",
  borderBottom: "1px solid #444",
  color: "#ddd",
  cursor: "grab",
  userSelect: "none",
  "&:active": { cursor: "grabbing" },
});
const closeButton = css({
  width: "22px",
  height: "22px",
  padding: "0",
  background: "transparent",
  border: "0",
  borderRadius: "4px",
  color: "#aaa",
  font: "18px/1 monospace",
  cursor: "pointer",
  "&:hover": { background: "#6b2020", color: "#fff" },
});
const body = css({
  flex: "1",
  minHeight: "0",
  overflow: "auto",
  "& button, & select, & input": {
    background: "#222",
    color: "#fff",
    border: "1px solid #444",
    borderRadius: "4px",
    font: "inherit",
  },
  "& button": { cursor: "pointer", padding: "4px 8px" },
  "& input, & select": { padding: "4px 6px" },
  "& button:disabled": { opacity: "0.5", cursor: "default" },
});
const grip = css({
  position: "absolute",
  right: "0",
  bottom: "0",
  width: "16px",
  height: "16px",
  cursor: "nwse-resize",
  touchAction: "none",
  borderRight: "3px solid #777",
  borderBottom: "3px solid #777",
});

function bindWindow(node: HTMLElement, id: string, signal: AbortSignal) {
  const title = node.querySelector<HTMLElement>("[data-window-title]");
  const resize = node.querySelector<HTMLElement>("[data-window-resize]");
  function start(event: PointerEvent, mode: "move" | "resize") {
    if (event.button !== 0 || (event.target as Element).closest("button"))
      return;
    const win = useGameStore.getState().windows[id];
    if (!win) return;
    event.preventDefault();
    useGameStore.getState().focusWindow(id);
    const gesture = new AbortController();
    signal.addEventListener("abort", () => gesture.abort(), { once: true });
    const startX = event.clientX;
    const startY = event.clientY;
    let x = win.x;
    let y = win.y;
    let w = win.w;
    let h = win.h;
    window.addEventListener(
      "pointermove",
      (move) => {
        const dx = move.clientX - startX;
        const dy = move.clientY - startY;
        if (mode === "move") {
          x = Math.max(0, Math.min(win.x + dx, innerWidth - w));
          y = Math.max(0, Math.min(win.y + dy, innerHeight - 28));
          node.style.left = `${x}px`;
          node.style.top = `${y}px`;
        } else {
          w = Math.max(200, Math.min(win.w + dx, innerWidth - win.x));
          h = Math.max(56, Math.min(win.h + dy, innerHeight - win.y));
          node.style.width = `${w}px`;
          node.style.height = `${h}px`;
        }
      },
      { signal: gesture.signal },
    );
    window.addEventListener(
      "pointerup",
      () => {
        gesture.abort();
        if (mode === "move") useGameStore.getState().setWindowPos(id, x, y);
        else useGameStore.getState().setWindowSize(id, w, h);
      },
      { once: true, signal: gesture.signal },
    );
  }
  title?.addEventListener("pointerdown", (event) => start(event, "move"), {
    signal,
  });
  resize?.addEventListener("pointerdown", (event) => start(event, "resize"), {
    signal,
  });
}

export function BurgerWindow(
  handle: Handle<{ state: WindowState; children: RemixNode }>,
) {
  return () => {
    const { state, children } = handle.props;
    return (
      <section
        role="dialog"
        aria-labelledby={`burger-window-${state.id}-title`}
        data-burger-window={state.id}
        mix={[
          frame,
          ref((node, signal) => bindWindow(node, state.id, signal)),
          on("pointerdown", () =>
            useGameStore.getState().focusWindow(state.id),
          ),
        ]}
        style={{
          left: state.x,
          top: state.y,
          width: state.w,
          height: state.h,
          zIndex: state.z + 100,
        }}
      >
        <div mix={titlebar} data-window-title="">
          <span id={`burger-window-${state.id}-title`}>{state.title}</span>
          <button
            type="button"
            aria-label={`Close ${state.title}`}
            mix={[
              closeButton,
              on("click", () => useGameStore.getState().closeWindow(state.id)),
            ]}
          >
            ×
          </button>
        </div>
        <div mix={body}>{children}</div>
        <div data-window-resize="" mix={grip} aria-hidden="true" />
      </section>
    );
  };
}
