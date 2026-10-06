import { run } from "remix/component";

// Full document navigation ensures unsaved-work prompts and embed lifecycles remain reliable.
document.addEventListener(
  "click",
  (event) => {
    if (event.target instanceof Element)
      event.target.closest("a")?.setAttribute("data-rmx-document", "");
  },
  true,
);
document.addEventListener(
  "submit",
  (event) => {
    if (event.target instanceof HTMLFormElement)
      event.target.setAttribute("data-rmx-document", "");
  },
  true,
);

const app = run({
  async loadModule(moduleUrl, exportName) {
    let mod = await import(moduleUrl);
    return mod[exportName];
  },
});

// Server-rendered fields must not accept edits before their handlers exist.
void app
  .ready()
  .then(() => {
    const workspace = document.getElementById("workspace");
    workspace?.removeAttribute("inert");
    workspace?.removeAttribute("aria-busy");
    const status = document.getElementById("workspace-readiness");
    if (status) {
      status.textContent = "Editing workspace";
      status.removeAttribute("role");
    }
  })
  .catch(() => {
    const status = document.getElementById("workspace-readiness");
    if (status)
      status.textContent =
        "Editing tools failed to load. Please reload this page.";
  });

if (import.meta.hot) {
  import.meta.hot.on("server:update", async () => {
    try {
      await app.ready();
      await app.frames.top.reload();
    } catch (error) {
      console.error("Error reloading top frame on server update", error);
    }
  });
}
