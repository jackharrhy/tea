import PicoCADViewer from "./mug/pico-cad-viewer.js";

const canvas = document.getElementById("mug-canvas");
if (canvas) {
  const home = window.location.pathname === "/";
  const viewer = new PicoCADViewer({
    canvas,
    fov: 15,
    resolution: home ? { width: 250, height: 180 } : { width: 100, height: 50 },
  });
  viewer.backgroundColor = [0, 0, 0, 0];
  const response = await fetch(new URL("./mug/cuppa.txt", import.meta.url));
  if (response.ok) {
    viewer.load(await response.text());
    let spin = 0;
    viewer.startDrawLoop((dt) => {
      spin += dt;
      viewer.setTurntableCamera(8, spin, 0.07, { x: 0, y: 0.6, z: 0 });
      viewer.setLightDirectionFromCamera();
    });
    window.addEventListener("pagehide", () => viewer.stopDrawLoop(), {
      once: true,
    });
  }
}

for (const element of document.querySelectorAll("[data-now-playing]")) {
  fetch(
    `/tools/lastfm/now-playing${element.dataset.nowPlaying === "debug" ? "?debug" : ""}`,
  )
    .then(async (response) => {
      if (response.status === 200) element.innerHTML = await response.text();
    })
    .catch(console.error);
}

for (const form of document.querySelectorAll("form[data-fragment]")) {
  form.addEventListener("submit", async (event) => {
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
}

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
