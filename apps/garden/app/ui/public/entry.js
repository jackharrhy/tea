import { run } from "remix/component";

let transition;
window.navigation?.addEventListener("navigate", (event) => {
  if (
    !event.canIntercept ||
    event.hashChange ||
    event.downloadRequest !== null ||
    event.formData ||
    new URL(event.destination.url).origin !== location.origin
  )
    return;
  if (
    !("sourceElement" in event) ||
    event.sourceElement?.closest("[data-rmx-document]")
  )
    return;
  transition?.skipTransition();
  if (
    document.startViewTransition &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    const settled = new Promise((resolve) => {
      const finish = () => {
        controller.abort();
        resolve();
      };
      const controller = new AbortController();
      navigation.addEventListener("navigatesuccess", finish, {
        once: true,
        signal: controller.signal,
      });
      navigation.addEventListener("navigateerror", finish, {
        once: true,
        signal: controller.signal,
      });
      event.signal.addEventListener("abort", finish, { once: true });
    });
    transition = document.startViewTransition(() => settled);
    transition.finished.catch(() => {});
  }
});

const app = run({
  async loadModule(url, name) {
    return (await import(url))[name];
  },
});
app.addEventListener("error", (event) => console.error(event.error));

if (document.querySelector('script[data-development="true"]')) {
  let previous;
  setInterval(async () => {
    try {
      const response = await fetch("/__dev/revision", { cache: "no-store" });
      if (!response.ok) return;
      const revision = await response.text();
      if (previous !== undefined && previous !== revision)
        window.location.reload();
      previous = revision;
    } catch {
      /* The development server may be restarting. */
    }
  }, 750);
}
