import { startDoodle } from "./doodle-webgl.mjs";
const original = document.querySelector("canvas.auth-art[data-doodle]");
const layer = original?.parentElement;
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const scheme = matchMedia("(prefers-color-scheme: dark)");
let renderer,
  canvas = original,
  entrance;
function setup() {
  entrance?.cancel();
  renderer?.stop();
  canvas?.remove();
  if (!original || !layer) return;
  const next = original.cloneNode();
  canvas = next;
  layer.append(next);
  const fallback = () => {
    entrance?.cancel();
    next.remove();
  };
  try {
    renderer = startDoodle(next, {
      id: original.dataset.doodle,
      day: original.dataset.day,
      settings: JSON.parse(original.dataset.settings || "{}"),
      dark: scheme.matches,
      motion: !preference.matches,
      onFallback: fallback,
    });
    if (!renderer.supported) {
      fallback();
      return;
    }
    const opacity = scheme.matches ? 0.65 : 0.55;
    if (preference.matches) next.style.opacity = String(opacity);
    else
      entrance = next.animate([{ opacity: 0 }, { opacity }], {
        duration: 900,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      });
  } catch {
    renderer?.stop();
    fallback();
  }
}
setup();
preference.addEventListener("change", setup);
scheme.addEventListener("change", setup);
