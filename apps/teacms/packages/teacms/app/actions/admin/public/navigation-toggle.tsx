import { clientEntry, on, type Handle } from "remix/component";

export function NavigationButton(handle: Handle) {
  let collapsed = false;
  function apply(value: boolean) {
    collapsed = value;
    document.body.classList.toggle("cms-navigation-collapsed", collapsed);
    const nav = document.getElementById("cms-navigation");
    if (nav) {
      nav.hidden = collapsed;
      nav.inert = collapsed;
    }
    handle.update();
  }
  function toggle(value: boolean) {
    apply(value);
    try {
      localStorage.setItem("tea-navigation-collapsed", String(value));
    } catch {}
  }
  handle.queueTask(() => {
    document
      .getElementById("close-cms-navigation")
      ?.addEventListener("click", () => toggle(true), {
        signal: handle.signal,
      });
    try {
      const saved = localStorage.getItem("tea-navigation-collapsed");
      apply(
        saved === null
          ? !!document.querySelector(".cms-editor") &&
              matchMedia("(max-width: 800px)").matches
          : saved === "true",
      );
    } catch {}
  });
  return () => (
    <button
      type="button"
      className="button small navigation-toggle"
      aria-controls="cms-navigation"
      aria-expanded={!collapsed}
      mix={on("click", () => toggle(!collapsed))}
    >
      {collapsed ? "☰ Show navigation" : "☰ Hide navigation"}
    </button>
  );
}
export const NavigationToggle = clientEntry(
  import.meta.url + "#NavigationToggle",
  NavigationButton,
);
