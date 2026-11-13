import { css } from "remix/component";
import { renderToString } from "remix/component/server";

const panel = css({
  position: "fixed",
  zIndex: 10,
  bottom: "12px",
  right: "12px",
  width: "min(340px, calc(100% - 24px))",
  maxHeight: "65svh",
  overflow: "auto",
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: "12px",
  padding: "12px 16px",
  "& summary": {
    cursor: "pointer",
    minHeight: "44px",
    padding: "10px 0",
    fontWeight: 600,
  },
  "& form": { display: "grid", gap: "12px" },
  "& p": { fontSize: "12px", margin: "4px 0 12px" },
  "& label": { fontSize: "13px" },
  "& select, & button": { minHeight: "44px" },
  "& output": { display: "block", fontSize: "12px", marginTop: "12px" },
});
export const choices = {
  layer: {
    plain: "Plain / no effect",
    webgl: "WebGL only",
  },
  effect: {
    waves: "Waves · line bands (existing default)",
    silk: "Silk · soft folds",
    "silk-braid": "Silk braid · three ribbons",
    "caustic-glass": "Caustic glass · light field",
  },
  palette: {
    neutral: "Neutral / no chroma",
    blue: "Blue / red / yellow",
    cyan: "Cyan / magenta / orange",
  },
  surface: { cool: "Cool paper", white: "White", warm: "Warm paper" },
  motion: {
    still: "Hold still (fixed seed + time)",
    animate: "Animate selected WebGL",
  },
  entrance: {
    none: "No entrance",
    fade: "Fade whole background layer (same artwork)",
  },
};
export function optionsFrom(search: URLSearchParams) {
  return Object.fromEntries(
    Object.entries(choices).map(([key, values]) => {
      const candidate = search.get(key);
      return [
        key,
        candidate && Object.hasOwn(values, candidate)
          ? candidate
          : Object.keys(values)[0],
      ];
    }),
  ) as Record<keyof typeof choices, string>;
}
const labels: Record<string, string> = {
  layer: "Background",
  effect: "Existing effect",
  palette: "Color",
  surface: "Paper surface",
  motion: "Motion",
  entrance: "Layer entrance",
};
export function renderExplorer(options: ReturnType<typeof optionsFrom>) {
  return renderToString(
    <details id="background-explorer" mix={panel}>
      <summary>Background options</summary>
      <p>
        Safe preview: sign-in disabled. Changes appear immediately and stay in
        the URL. Hold still for a repeatable view. WebGL unavailable? Plain
        paper stays visible.
      </p>
      <form method="get" action="/login">
        {Object.entries(choices).map(([key, values]) => (
          <label>
            {labels[key]}
            <select name={key} aria-label={labels[key]}>
              {Object.entries(values).map(([value, label]) => (
                <option
                  value={value}
                  selected={options[key as keyof typeof choices] === value}
                >
                  {label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </form>
      <output id="explorer-status" aria-live="polite">
        Preparing selected background.
      </output>
    </details>,
    { nonce: "fixture" },
  );
}
