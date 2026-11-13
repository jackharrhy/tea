import { startDoodle } from "/doodle-webgl.mjs";
import {
  doodles,
  defaultPool,
  dailyDoodle,
  renderDoodle,
  paletteForDay,
  parameterSpec,
  doodleParameters,
} from "/doodle-spec.mjs";
const $ = (selector) => document.querySelector(selector);
let settings = {},
  activeId;
let renderer,
  posterRenderer,
  posterCanvas,
  posterKey = "",
  posterRevision = 0;
const posters = new Map();
async function paintPosters(version) {
  const key = day() + "/" + $("#dark").checked + "/" + JSON.stringify(settings);
  if (key !== posterKey) {
    for (const url of posters.values()) URL.revokeObjectURL(url);
    posters.clear();
    posterKey = key;
  }
  if (!posterCanvas) {
    posterCanvas = document.createElement("canvas");
    posterCanvas.className = "poster-canvas";
    posterCanvas.setAttribute("aria-hidden", "true");
    document.body.append(posterCanvas);
    posterRenderer = startDoodle(posterCanvas, {
      id: "waves",
      day: day(),
      dark: $("#dark").checked,
      motion: false,
    });
  }
  if (!posterRenderer.supported) return;
  for (const item of doodles) {
    if (version !== posterRevision) return;
    let url = posters.get(item.id);
    if (!url) {
      posterRenderer.setTheme(
        item.id,
        day(),
        $("#dark").checked,
        settings[item.id],
      );
      const blob = await new Promise((resolve) =>
        posterCanvas.toBlob(resolve, "image/png"),
      );
      if (!blob || version !== posterRevision) return;
      url = URL.createObjectURL(blob);
      posters.set(item.id, url);
    }
    const button = $(`[data-preview="${item.id}"]`);
    if (!button) return;
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    button.replaceChildren(image);
  }
}

let enabled = [...defaultPool],
  revision = 0,
  manual = null;
$("#day").value = new Date().toISOString().slice(0, 10);
$("#motion").checked = !matchMedia("(prefers-reduced-motion: reduce)").matches;
function day() {
  return /^\d{4}-\d{2}-\d{2}$/.test($("#day").value)
    ? $("#day").value
    : new Date().toISOString().slice(0, 10);
}
function render() {
  const id = manual || dailyDoodle(enabled, day());
  activeId = id;
  const values = doodleParameters(settings[id]);
  $("#tuning-name").textContent = doodles.find((item) => item.id === id).name;
  for (const [key, value] of Object.entries(values)) {
    const input = $("#param-" + key);
    input.value = value;
    $("#value-" + key).textContent = value.toFixed(2);
  }
  renderer?.stop();
  $("#art").innerHTML = renderDoodle(id, day(), settings[id]);
  const fallback = $("#art svg"),
    canvas = document.createElement("canvas");
  canvas.className = "motion-canvas";
  canvas.setAttribute("aria-hidden", "true");
  $("#art").append(canvas);
  renderer = startDoodle(canvas, {
    id,
    settings: settings[id],
    day: day(),
    dark: $("#dark").checked,
    motion: $("#motion").checked,
    onFallback: () => {
      fallback.removeAttribute("hidden");
      canvas.remove();
      $("#renderer").textContent = "Static";
    },
  });
  if (renderer.supported) {
    fallback.setAttribute("hidden", "");
    $("#renderer").textContent = $("#motion").checked
      ? "WebGL · moving"
      : "WebGL · paused";
  } else {
    canvas.remove();
    $("#renderer").textContent = "Static fallback";
  }
  $("#current").textContent = doodles.find((item) => item.id === id).name;
  $("#day-note").textContent = paletteForDay(day()).name + " · daily UTC";
  $("#count").textContent = `${enabled.length} selected`;
  $("#rotation").setAttribute("aria-pressed", String(manual === null));
  document.body.classList.toggle("dark", $("#dark").checked);
  $("#pool").innerHTML = doodles
    .map(
      (item) =>
        `<article class="concept${item.id === id ? " selected" : ""}"><button class="thumbnail" data-preview="${item.id}" aria-label="Preview ${item.name}">${renderDoodle(item.id, day(), settings[item.id])}</button><div><label><input type="checkbox" data-pool="${item.id}" ${enabled.includes(item.id) ? "checked" : ""}> ${item.name}</label></div></article>`,
    )
    .join("");
  $("#pool")
    .querySelectorAll("[data-preview]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        manual = button.dataset.preview;
        render();
      }),
    );
  paintPosters(++posterRevision);
  $("#pool")
    .querySelectorAll("[data-pool]")
    .forEach((input) =>
      input.addEventListener("change", () => {
        const next = doodles
          .filter((item) =>
            item.id === input.dataset.pool
              ? input.checked
              : enabled.includes(item.id),
          )
          .map((item) => item.id);
        if (!next.length) {
          input.checked = true;
          $("#status").textContent = "Keep at least one.";
          return;
        }
        enabled = next;
        $("#status").textContent = "Not saved";
        render();
      }),
    );
}
function shift(amount) {
  const date = new Date(day() + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + amount);
  $("#day").value = date.toISOString().slice(0, 10);
  render();
}
$("#previous").addEventListener("click", () => shift(-1));
$("#next").addEventListener("click", () => shift(1));
$("#today").addEventListener("click", () => {
  $("#day").value = new Date().toISOString().slice(0, 10);
  render();
});
$("#day").addEventListener("change", render);
$("#dark").addEventListener("change", render);
$("#motion").addEventListener("change", render);
$("#rotation").addEventListener("click", () => {
  manual = null;
  render();
});
$("#save").addEventListener("click", async () => {
  $("#save").disabled = true;
  $("#status").textContent = "Saving…";
  try {
    const response = await fetch("/api/pool", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, settings, expectedRevision: revision }),
    });
    const value = await response.json();
    if (!response.ok) throw Error(value.error);
    revision = value.revision;
    $("#status").textContent = "Saved";
  } catch (error) {
    $("#status").textContent = error.message || "Could not save.";
  } finally {
    $("#save").disabled = false;
  }
});
$("#parameters").innerHTML = Object.entries(parameterSpec)
  .map(
    ([key, spec]) =>
      `<div class="parameter"><label for="param-${key}">${spec.label}<output id="value-${key}" for="param-${key}"></output></label><input id="param-${key}" aria-label="${spec.label}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}"></div>`,
  )
  .join("");
for (const key of Object.keys(parameterSpec)) {
  const input = $("#param-" + key);
  input.addEventListener("input", () => {
    settings[activeId] = {
      ...doodleParameters(settings[activeId]),
      [key]: Number(input.value),
    };
    $("#value-" + key).textContent = Number(input.value).toFixed(2);
    renderer?.setSettings(settings[activeId]);
    $("#status").textContent = "Not saved";
  });
  input.addEventListener("change", () => paintPosters(++posterRevision));
}
$("#reset-settings").addEventListener("click", () => {
  delete settings[activeId];
  $("#status").textContent = "Not saved";
  render();
});
try {
  const response = await fetch("/api/pool");
  if (!response.ok) throw Error();
  const saved = await response.json();
  enabled = saved.enabled;
  settings = saved.settings || {};
  revision = saved.revision;
} catch {
  $("#status").textContent = "Could not load pool.";
  $("#save").disabled = true;
}
render();
