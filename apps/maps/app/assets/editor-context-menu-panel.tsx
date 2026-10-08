import { clientEntry, on, ref, type Handle } from "remix/component";
import type {
  EditorContextMenuContext,
  ContextAction,
} from "./editor-context-menu.ts";

export const EditorContextMenu = clientEntry(
  `file:///app/assets/editor-context-menu-panel.tsx#EditorContextMenu`,
  function EditorContextMenuComponent(handle: Handle) {
    let context: EditorContextMenuContext | null = null;
    let root: HTMLDivElement | null = null;

    function buttons(): HTMLButtonElement[] {
      return root
        ? [...root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]
        : [];
    }

    function positionAndFocus() {
      if (!root || !context?.state.visible) return;
      root.style.left = `${Math.max(8, Math.min(context.state.x, window.innerWidth - root.offsetWidth - 8))}px`;
      root.style.top = `${Math.max(8, Math.min(context.state.y, window.innerHeight - root.offsetHeight - 8))}px`;
      buttons()[0]?.focus();
    }

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-context-menu-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-context-menu-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-context-menu-state",
        (event) => {
          context = (event as CustomEvent<EditorContextMenuContext>).detail;
          handle.update();
          handle.queueTask(positionAndFocus);
        },
        { signal: handle.signal },
      );
      document.addEventListener(
        "pointerdown",
        (event) => {
          if (
            context?.state.visible &&
            root &&
            !root.contains(event.target as Node)
          )
            context.hide();
        },
        { signal: handle.signal },
      );
      document.addEventListener(
        "contextmenu",
        (event) => {
          if (
            context?.state.visible ||
            (event.target instanceof HTMLCanvasElement &&
              event.target.closest(".viewport-frame"))
          )
            event.preventDefault();
        },
        { signal: handle.signal },
      );
      window.addEventListener("blur", () => context?.hide(), {
        signal: handle.signal,
      });
      window.dispatchEvent(new Event("tea-maps-context-menu-ready"));
    });

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        context?.hide(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = buttons();
      if (!items.length) return;
      const current = items.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowDown"
              ? (current + 1) % items.length
              : (current + items.length - 1) % items.length;
      items[index]?.focus();
    }

    function menuAction(action: ContextAction) {
      context?.runAction(action);
    }

    return () => (
      <div
        id="viewport-context-menu"
        role="menu"
        aria-label="Map view actions"
        hidden={!context?.state.visible}
        mix={[
          ref<HTMLDivElement>((node) => {
            root = node;
          }),
          on<HTMLDivElement>("keydown", (event) => {
            if ("key" in event) handleKeydown(event as KeyboardEvent);
          }),
        ]}
      >
        {(context?.state.sections ?? []).map((section) => (
          <div role="group" aria-label={section.label}>
            <div class="context-heading">{section.label}</div>
            {section.actions.map((action) => (
              <button
                type="button"
                role="menuitem"
                disabled={action.disabled ?? false}
                mix={on("click", () => menuAction(action))}
              >
                {action.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  },
);
