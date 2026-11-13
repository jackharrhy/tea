import { startDoodle } from "/assets/doodle-webgl.mjs";
const panel = document.querySelector("#background-explorer");
const form = panel.querySelector("form");
const options = Object.fromEntries(new FormData(form));
const svg = document.querySelector("svg.auth-art");
const layer = document.querySelector(".artwork-layer");
const status = document.querySelector("#explorer-status");
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const scheme = matchMedia("(prefers-color-scheme: dark)");
let renderer, canvas, entrance;
// Explicit fixture controls only; product form and auth handlers are not loaded.
document
  .querySelector("[data-fixture-login]")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    status.textContent = "Fixture only: sign-in submissions are disabled.";
    panel.open = true;
  });
function setup() {
  entrance?.cancel();
  renderer?.stop();
  canvas?.remove();
  const hasSvg = options.layer === "svg" || options.layer === "both";
  svg.toggleAttribute("hidden", !hasSvg);
  const surface = { cool: "#f6f7f8", white: "#fff", warm: "#f7f4ee" }[
    options.surface
  ];
  layer.style.background = scheme.matches ? "#141617" : surface;
  let state =
    options.layer === "plain"
      ? "Plain surface; no effect."
      : "SVG only; static existing artwork.";
  if (options.layer === "webgl" || options.layer === "both") {
    canvas = document.createElement("canvas");
    canvas.className = "auth-art explorer-canvas";
    canvas.setAttribute("aria-hidden", "true");
    layer.append(canvas);
    const fallback = () => {
      canvas?.remove();
      svg.removeAttribute("hidden");
      status.textContent =
        "WebGL unavailable: static SVG fallback (no visual replacement animation).";
    };
    try {
      renderer = startDoodle(canvas, {
        id: svg.dataset.doodle,
        day: svg.dataset.day,
        settings: JSON.parse(svg.dataset.settings),
        dark: scheme.matches,
        motion: options.motion === "animate" && !preference.matches,
        onFallback: fallback,
      });
      if (!renderer.supported) {
        fallback();
        return;
      }
      state = `${options.layer === "both" ? "SVG + WebGL simultaneously" : "WebGL only"}; ${options.motion === "animate" && !preference.matches ? "animated" : "held at time zero"}${preference.matches ? " (reduced motion)" : ""}.`;
    } catch {
      renderer?.stop();
      fallback();
      return;
    }
  }
  status.textContent = `${state} Fixed seed; selection retained in URL.`;
  // This is a layer entrance, never a crossfade between two different artworks.
  if (options.entrance === "fade" && !preference.matches) {
    entrance = layer.animate([{ opacity: 0.15 }, { opacity: 1 }], {
      duration: 900,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    });
  }
}
setup();
preference.addEventListener("change", setup);
scheme.addEventListener("change", setup);
