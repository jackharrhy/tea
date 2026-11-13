import { startDoodle } from "./doodle-webgl.mjs";
const svg = document.querySelector("svg.auth-art[data-doodle]");
const preference = matchMedia("(prefers-reduced-motion: reduce)");
let renderer, canvas;
function setup() {
  renderer?.stop();
  canvas?.remove();
  svg?.removeAttribute("hidden");
  if (!svg || preference.matches) return;
  canvas = document.createElement("canvas");
  canvas.className = "auth-art motion-canvas";
  canvas.setAttribute("aria-hidden", "true");
  svg.after(canvas);
  renderer = startDoodle(canvas, {
    id: svg.dataset.doodle,
    day: svg.dataset.day,
    settings: JSON.parse(svg.dataset.settings || "{}"),
    dark: matchMedia("(prefers-color-scheme: dark)").matches,
    onFallback: () => {
      svg.removeAttribute("hidden");
      canvas.remove();
    },
  });
  if (renderer.supported) svg.setAttribute("hidden", "");
  else canvas.remove();
}
setup();
preference.addEventListener("change", setup);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", setup);
