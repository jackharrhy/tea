import PicoCADViewer from "./mug/pico-cad-viewer.js";
import { run } from "remix/component";

let viewer;
let mugCanvas;
function placeMug() {
  const slot = document.querySelector("[data-mug-slot]");
  if (!slot || !mugCanvas) return;
  slot.replaceChildren(mugCanvas);
  const home = window.location.pathname === "/";
  mugCanvas.className = home ? "my-16" : "my-0";
  viewer?.setResolution(home ? 250 : 100, home ? 180 : 50);
}

async function initializeMug() {
  const canvas = document.getElementById("mug-canvas");
  if (!canvas) return;
  mugCanvas = canvas;
  const home = window.location.pathname === "/";
  viewer = new PicoCADViewer({
    canvas,
    fov: 15,
    resolution: home ? { width: 250, height: 180 } : { width: 100, height: 50 },
  });
  viewer.backgroundColor = [0, 0, 0, 0];
  const response = await fetch(new URL("./mug/cuppa.txt", import.meta.url));
  if (response.ok) {
    viewer.load(await response.text());
    let spin = 0;
    const draw = (dt) => {
      spin += dt;
      viewer.setTurntableCamera(8, spin, 0.07, { x: 0, y: 0.6, z: 0 });
      viewer.setLightDirectionFromCamera();
    };
    viewer.startDrawLoop(draw);
    window.addEventListener("pagehide", () => viewer.stopDrawLoop());
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) viewer.startDrawLoop(draw);
    });
  }
}
initializeMug().catch(console.error);

const widgets = new WeakSet();
function initializeWidgets() {
  for (const element of document.querySelectorAll("[data-now-playing]")) {
    if (widgets.has(element)) continue;
    widgets.add(element);
    fetch(
      `/tools/lastfm/now-playing${element.dataset.nowPlaying === "debug" ? "?debug" : ""}`,
    )
      .then(async (response) => {
        if (response.status === 200) element.innerHTML = await response.text();
      })
      .catch(console.error);
  }
}
initializeWidgets();

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches("[data-fragment]"))
    return;
  event.preventDefault();
  const target = document.querySelector(form.dataset.fragment);
  try {
    const response = await fetch(form.action, {
      method: form.method,
      body: new FormData(form),
    });
    target.innerHTML = await response.text();
  } catch {
    target.textContent = "Request failed. Please try again.";
  }
});

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
window.navigation?.addEventListener("navigatesuccess", () => {
  placeMug();
  initializeWidgets();
});

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
