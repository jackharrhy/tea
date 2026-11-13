import { startDoodle } from "./doodle-webgl.mjs";
const svg = document.querySelector("svg.auth-art[data-doodle]");
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const scheme = matchMedia("(prefers-color-scheme: dark)");
let renderer, canvas, timer;
let animations = [];
function setup() {
  clearTimeout(timer);
  animations.forEach((animation) => animation.cancel());
  animations = [];
  renderer?.stop();
  canvas?.remove();
  svg?.removeAttribute("hidden");
  if (!svg || preference.matches) return;
  // Let the already-visible SVG settle before compiling the optional enhancement.
  timer = setTimeout(() => {
    const next = document.createElement("canvas");
    canvas = next;
    next.className = "auth-art motion-canvas";
    next.setAttribute("aria-hidden", "true");
    next.style.opacity = "0";
    svg.after(next);
    const fallback = () => {
      animations.forEach((animation) => animation.cancel());
      animations = [];
      svg.removeAttribute("hidden");
      next.remove();
    };
    try {
      renderer = startDoodle(next, {
        id: svg.dataset.doodle,
        day: svg.dataset.day,
        settings: JSON.parse(svg.dataset.settings || "{}"),
        dark: scheme.matches,
        onFallback: fallback,
      });
      if (!renderer.supported) {
        fallback();
        return;
      }
      // startDoodle draws its first frame synchronously. Never reveal a blank canvas.
      const opacity = getComputedStyle(svg).opacity;
      const timing = {
        duration: 1400,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      };
      animations = [
        next.animate([{ opacity: 0 }, { opacity }], timing),
        svg.animate([{ opacity }, { opacity: 0 }], timing),
      ];
    } catch {
      renderer?.stop();
      fallback();
    }
  }, 700);
}
setup();
preference.addEventListener("change", setup);
scheme.addEventListener("change", setup);
