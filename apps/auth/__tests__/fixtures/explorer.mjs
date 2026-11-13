import { startDoodle } from "/assets/doodle-webgl.mjs";
const panel = document.querySelector("#background-explorer");
const form = panel.querySelector("form");
const layer = document.querySelector(".artwork-layer");
const status = document.querySelector("#explorer-status");
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const scheme = matchMedia("(prefers-color-scheme: dark)");
let renderer, canvas, entrance;
document
  .querySelector("[data-fixture-login]")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    status.textContent = "Safe preview: sign-in is disabled.";
    panel.open = true;
  });
function setup() {
  const options = Object.fromEntries(new FormData(form));
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(options))
    url.searchParams.set(key, value);
  history.replaceState(null, "", url);
  entrance?.cancel();
  renderer?.stop();
  canvas?.remove();
  renderer = undefined;
  canvas = undefined;
  layer.style.background = scheme.matches
    ? "#141617"
    : { cool: "#f6f7f8", white: "#fff", warm: "#f7f4ee" }[options.surface];
  let state = "Plain paper; no effect.";
  if (options.layer === "webgl") {
    const next = document.createElement("canvas");
    canvas = next;
    next.className = "auth-art explorer-canvas";
    next.setAttribute("aria-hidden", "true");
    layer.append(next);
    const fallback = () => {
      next.remove();
      status.textContent =
        "WebGL unavailable: plain paper (no artwork fallback).";
    };
    try {
      renderer = startDoodle(next, {
        id: options.effect,
        day: options.palette === "cyan" ? "2026-01-15" : "2026-01-16",
        settings: { color: options.palette === "neutral" ? 0 : 1 },
        dark: scheme.matches,
        motion: options.motion === "animate" && !preference.matches,
        onFallback: fallback,
      });
      if (!renderer.supported) {
        fallback();
        return;
      }
      state = `WebGL only; ${options.motion === "animate" && !preference.matches ? "animated" : "held at time zero"}${preference.matches ? " (reduced motion)" : ""}.`;
    } catch {
      renderer?.stop();
      fallback();
      return;
    }
  }
  status.textContent = `${state} Fixed seed; URL updated.`;
  if (options.entrance === "fade" && !preference.matches) {
    entrance = layer.animate([{ opacity: 0.15 }, { opacity: 1 }], {
      duration: 900,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    });
  }
}
form.addEventListener("submit", (event) => event.preventDefault());
form.addEventListener("change", setup);
setup();
preference.addEventListener("change", setup);
scheme.addEventListener("change", setup);
