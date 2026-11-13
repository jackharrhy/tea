export const doodles = [
  { id: "silk", name: "Silk", mode: 1 },
  { id: "silk-folds", name: "Silk folds", mode: 2 },
  { id: "silk-sheen", name: "Silk sheen", mode: 3 },
  { id: "silk-veil", name: "Silk veil", mode: 4 },
  { id: "silk-braid", name: "Silk braid", mode: 5 },
  { id: "caustics", name: "Caustics", mode: 6 },
  { id: "caustic-glass", name: "Caustic glass", mode: 7 },
  { id: "caustic-ripples", name: "Caustic ripples", mode: 8 },
  { id: "caustic-tide", name: "Caustic tide", mode: 9 },
  { id: "caustic-deep", name: "Deep water", mode: 10 },
];
// Flexoki accents by Steph Ango: https://stephango.com/flexoki (MIT).
const flexoki = [
  "D14D41",
  "DA702C",
  "D0A215",
  "879A39",
  "3AA99F",
  "4385BE",
  "8B7EC8",
  "CE5D97",
];
const flexokiNames = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "magenta",
];
const rgbHex = (hex) =>
  [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
export function paletteForDay(day = new Date().toISOString().slice(0, 10)) {
  const serial = Math.floor(Date.parse(day + "T00:00:00Z") / 86400000) || 0;
  const index = ((serial % 8) + 8) % 8;
  const offsets = [0, 3, 5];
  return {
    id: "flexoki-" + index,
    name:
      "Flexoki · " +
      offsets.map((offset) => flexokiNames[(index + offset) % 8]).join(" / "),
    accent: [0.53, 0.54, 0.55],
    secondary: [0.72, 0.73, 0.74],
    streaks: offsets.map((offset) => rgbHex(flexoki[(index + offset) % 8])),
  };
}
export const parameterSpec = {
  color: { label: "Color strength", min: 0, max: 2, step: 0.01, value: 0.8 },
  saturation: {
    label: "Saturation",
    min: 0,
    max: 2.5,
    step: 0.01,
    value: 1.25,
  },
  iridescence: { label: "Iridescence", min: 0, max: 3, step: 0.01, value: 1 },
  contrast: { label: "Contrast", min: 0.5, max: 2, step: 0.01, value: 1 },
  speed: { label: "Motion speed", min: 0, max: 3, step: 0.01, value: 1 },
  scale: { label: "Pattern scale", min: 0.5, max: 2, step: 0.01, value: 1 },
};
export function doodleParameters(value = {}) {
  return Object.fromEntries(
    Object.entries(parameterSpec).map(([key, spec]) => [
      key,
      typeof value?.[key] === "number" && Number.isFinite(value[key])
        ? Math.min(spec.max, Math.max(spec.min, value[key]))
        : spec.value,
    ]),
  );
}
export function validSettings(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([id, settings]) =>
        doodles.some((item) => item.id === id) &&
        settings &&
        typeof settings === "object" &&
        !Array.isArray(settings) &&
        Object.entries(settings).every(
          ([key, n]) =>
            parameterSpec[key] &&
            typeof n === "number" &&
            Number.isFinite(n) &&
            n >= parameterSpec[key].min &&
            n <= parameterSpec[key].max,
        ),
    )
  );
}
export const defaultPool = ["silk-braid"];
export function validPool(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= doodles.length &&
    new Set(value).size === value.length &&
    value.every((id) => doodles.some((item) => item.id === id))
  );
}
export function doodleSeed(id, day) {
  let state = 2166136261;
  for (const char of `${id}/${day}`)
    state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return (state >>> 0) / 4294967296;
}
export function dailyDoodle(
  pool = defaultPool,
  day = new Date().toISOString().slice(0, 10),
) {
  const enabled = validPool(pool) ? pool : defaultPool,
    serial = Math.floor(Date.parse(day + "T00:00:00Z") / 86400000);
  return enabled[
    (((Number.isFinite(serial) ? serial : 0) % enabled.length) +
      enabled.length) %
      enabled.length
  ];
}
const n = (value) => Number(value.toFixed(2));
const rgb = (value) =>
  `rgb(${value.map((channel) => Math.round(channel * 255)).join(",")})`;
export function renderDoodle(
  id,
  day = new Date().toISOString().slice(0, 10),
  settings = {},
) {
  const theme = doodles.some((item) => item.id === id) ? id : "silk-braid",
    seed = doodleSeed(theme, day) * 6,
    paths = [];
  const palette = paletteForDay(day);
  const ink = rgb(palette.accent),
    fill = rgb(palette.secondary);
  const count = theme.startsWith("silk")
    ? 18
    : theme.startsWith("caustic")
      ? 30
      : 40;
  for (let layer = 0; layer < (theme.startsWith("caustic") ? 2 : 1); layer++)
    for (let line = -6; line < count; line++) {
      let d = "";
      for (let x = -40; x <= 1480; x += 16) {
        const u = x / 1440;
        let y =
          line * (1000 / (count - 6)) +
          Math.sin(x / 150 + seed + line * 0.11) * 65 +
          Math.cos(x / 330 + seed) * 45;
        if (theme.startsWith("silk"))
          y =
            line * 85 +
            Math.sin(u * 5 + seed + line * 0.12) * 230 +
            Math.sin(u * 11 + line * 0.04) * 28;
        if (theme.startsWith("caustic"))
          y +=
            Math.sin(u * 9 + line * 0.27) * 90 +
            Math.cos(u * 17 + line * 0.2 + seed) * 40;
        if (theme === "silk-veil")
          y =
            line * 100 +
            Math.sin(u * 4 + seed + line * 0.24) * 260 +
            Math.cos(u * 8 + seed) * 45;
        if (theme === "caustic-deep")
          y +=
            Math.sin(u * 22 + line * 0.45 + seed) * 16 +
            Math.cos(u * 13 - line * 0.5) * 12;
        d += `${x === -40 ? "M" : " L"} ${x} ${n(y)}`;
      }
      const wide = theme.startsWith("silk");
      paths.push(
        `<path d="${d}" fill="none" stroke="${wide || line % 6 === 0 ? fill : ink}" stroke-width="${wide ? 28 : line % 6 === 0 ? 8 : 1}" opacity="${layer ? 0.2 : wide ? 0.3 : 0.45}"/>`,
      );
    }
  return `<svg class="auth-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-doodle="${theme}" data-day="${day.replace(/[^0-9-]/g, "")}" data-settings="${JSON.stringify(doodleParameters(settings)).replaceAll('"', "&quot;")}" data-palette="${palette.id}">${paths.join("")}</svg>`;
}
