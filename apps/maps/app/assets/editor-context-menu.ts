export interface ContextAction {
  readonly label: string;
  readonly disabled?: boolean;
  run(): unknown;
}

export interface ContextSection {
  readonly label: string;
  readonly actions: readonly ContextAction[];
}

export function createEditorContextMenu(
  root: HTMLElement,
  report: (error: unknown) => void,
) {
  let focusTarget: HTMLElement | null = null;

  function hide(restoreFocus = false) {
    if (root.hidden) return;
    root.hidden = true;
    root.replaceChildren();
    if (restoreFocus) focusTarget?.focus({ preventScroll: true });
    focusTarget = null;
  }

  function buttons(): HTMLButtonElement[] {
    return [
      ...root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
  }

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hide(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = buttons();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1) % items.length
            : (current + items.length - 1) % items.length;
    items[index]?.focus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!root.hidden && !root.contains(event.target as Node)) hide();
  });
  document.addEventListener("contextmenu", (event) => {
    if (
      !root.hidden ||
      (event.target instanceof HTMLCanvasElement &&
        event.target.closest(".viewport-frame"))
    ) {
      event.preventDefault();
    }
  });
  window.addEventListener("blur", () => hide());

  function show(
    x: number,
    y: number,
    sections: readonly ContextSection[],
    returnFocus: HTMLElement | null,
  ) {
    hide();
    focusTarget = returnFocus;
    for (const section of sections) {
      if (!section.actions.length) continue;
      const group = document.createElement("div");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", section.label);
      const heading = document.createElement("div");
      heading.className = "context-heading";
      heading.textContent = section.label;
      group.append(heading);
      for (const action of section.actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = action.label;
        button.disabled = action.disabled ?? false;
        button.addEventListener("click", () => {
          hide(true);
          void Promise.resolve()
            .then(() => action.run())
            .catch(report);
        });
        group.append(button);
      }
      root.append(group);
    }
    root.hidden = false;
    root.style.left = `${Math.max(8, Math.min(x, window.innerWidth - root.offsetWidth - 8))}px`;
    root.style.top = `${Math.max(8, Math.min(y, window.innerHeight - root.offsetHeight - 8))}px`;
    buttons()[0]?.focus();
  }

  return { show, hide };
}
