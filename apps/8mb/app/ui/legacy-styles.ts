// Migrated from the deployed Astro CSS. Rule order and rounded values preserve visual parity.
import { css } from "remix/component";
export const legacyStyles = [
  css({
    "&": {
      "font-family": "Inter, Arial, sans-serif",
      "font-size": "14px",
      "color-scheme": "light dark",
      "--bg": "#fafaf9",
      "--panel": "#f5f5f4",
      "--ink": "#0c0a09",
      "--muted": "#57534e",
      "--line": "#e7e5e4",
      "--border": "#78716c",
      "--hover": "#e7e5e4",
      "--accent": "#2563eb",
      "--selected": "#dbeafe",
      "--error": "#b91c1c",
      "--on-primary": "#fafaf9",
      background: "var(--bg)",
      color: "var(--ink)",
      "font-synthesis": "none",
      "-webkit-font-smoothing": "antialiased",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& *": {
      "box-sizing": "border-box",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& body": {
      margin: "0",
      "min-width": "320px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& button, & input, & select, & textarea": {
      font: "inherit",
      border: "1px solid var(--border)",
      "border-radius": "6px",
      background: "var(--bg)",
      color: "var(--ink)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& button, & .button": {
      display: "inline-flex",
      "min-height": "40px",
      "align-items": "center",
      "justify-content": "center",
      padding: "8px 13px",
      cursor: "pointer",
      "font-weight": "500",
      "text-decoration": "none",
      "white-space": "nowrap",
      gap: "8px",
      "touch-action": "manipulation",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& button:hover, & .button:hover": {
      background: "var(--hover)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& button:active, & .button:active": {
      transform: "translateY(1px)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& button:disabled": {
      color: "var(--muted)",
      cursor: "not-allowed",
      opacity: "0.55",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& input, & select": {
      width: "100%",
      height: "40px",
      padding: "0 10px",
      "min-width": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& input": {
      "font-variant-numeric": "tabular-nums",
      "caret-color": "var(--ink)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& textarea": {
      width: "100%",
      padding: "12px",
      resize: "vertical",
      "line-height": "1.6",
      "font-family": "ui-monospace, monospace",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& label": {
      display: "grid",
      gap: "8px",
      "font-weight": "500",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& a": {
      color: "inherit",
      "text-underline-offset": "4px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& a:hover": {
      "text-decoration-thickness": "2px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& summary": {
      cursor: "pointer",
      "min-height": "40px",
      display: "list-item",
      padding: "10px 0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& h1, & h2, & p": {
      margin: "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& h1": {
      "font-size": "24px",
      "line-height": "32px",
      "font-weight": "600",
      "letter-spacing": "-0.03em",
      "text-wrap": "balance",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& h2": {
      "font-size": "14px",
      "line-height": "22px",
      "font-weight": "600",
      "text-wrap": "balance",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& p": {
      "line-height": "1.6",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& fieldset": {
      border: "0",
      padding: "0",
      margin: "0",
      "min-width": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& fieldset:disabled": {
      opacity: "0.6",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& legend": {
      "font-size": "12px",
      "margin-bottom": "10px",
      color: "var(--muted)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& :where(a, button, input, select, textarea, summary, [tabindex]):focus-visible":
      {
        outline: "2px solid var(--muted)",
        "outline-offset": "3px",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& ::selection": {
      background: "var(--selected)",
      color: "var(--ink)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& [hidden]": {
      display: "none !important",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .muted, & .hint": {
      color: "var(--muted)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .hint": {
      "font-size": "12px",
      "line-height": "1.6",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .primary": {
      background: "var(--ink)",
      color: "var(--on-primary)",
      border: "1px solid var(--ink)",
      "border-radius": "6px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .primary:hover": {
      background: "var(--muted)",
      color: "var(--on-primary)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .with-icon svg": {
      width: "16px",
      height: "16px",
      "stroke-width": "1.6",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .toolbar": {
      display: "flex",
      "align-items": "center",
      "justify-content": "flex-end",
      gap: "16px",
      "margin-bottom": "20px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .workspace": {
      "max-width": "900px",
      padding: "0 24px",
      margin: "24px auto 0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .editing": {
      "min-width": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .file-info": {
      display: "flex",
      gap: "16px",
      "align-items": "center",
      "margin-bottom": "0",
      "min-height": "20px",
      flex: "1",
      "min-width": "0",
      "font-size": "12px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .file-info strong": {
      "font-weight": "500",
      "white-space": "nowrap",
      overflow: "hidden",
      "text-overflow": "ellipsis",
      "max-width": "55%",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .file-info span": {
      "margin-left": "auto",
      "text-align": "right",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .preview": {
      height: "370px",
      position: "relative",
      display: "grid",
      "place-items": "center",
      background: "var(--panel)",
      border: "1px solid var(--line)",
      "border-radius": "8px",
      overflow: "hidden",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .preview:has(video:not([hidden])), & .preview:has(#frame:not([hidden]))":
      {
        background: "#0c0a09",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .preview.dragover": {
      outline: "2px dashed var(--accent)",
      "outline-offset": "4px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .preview video, & .preview > canvas": {
      width: "100%",
      height: "100%",
      "object-fit": "contain",
      "min-width": "0",
      "min-height": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .empty-state": {
      display: "flex",
      "align-items": "center",
      "flex-direction": "column",
      "text-align": "center",
      padding: "28px",
      gap: "16px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .empty-state h2": {
      "font-size": "18px",
      "line-height": "26px",
      "letter-spacing": "-0.02em",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .empty-state p": {
      "font-size": "13px",
      color: "var(--muted)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .film-icon": {
      width: "30px",
      height: "30px",
      "stroke-width": "1.2",
      color: "var(--muted)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .empty-state .hint": {
      "margin-top": "2px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .preview-tools": {
      display: "flex",
      gap: "8px",
      "align-items": "center",
      "margin-top": "12px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .preview-tools button": {
      "font-size": "12px",
      "min-height": "34px",
      padding: "6px 10px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .preview-tools span": {
      "margin-left": "auto",
      "font-size": "12px",
    },
  } as Parameters<typeof css>[0]),
  css({
    '& .preview-tools button[aria-pressed="true"]': {
      background: "var(--selected)",
      "border-color": "var(--accent)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #crop-overlay": {
      position: "absolute",
      inset: "0",
      "touch-action": "none",
      cursor: "crosshair",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #crop-box": {
      position: "absolute",
      border: "2px solid #fff",
      "box-shadow": "0 0 0 9999px #0008",
      "pointer-events": "none",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #crop-box:after": {
      content: '""',
      position: "absolute",
      inset: "33%",
      border: "1px solid #ffffff80",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #crop-fields": {
      "margin-top": "18px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .four-fields": {
      display: "grid",
      "grid-template-columns": "repeat(4, minmax(0, 1fr))",
      gap: "10px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .four-fields label": {
      "font-size": "12px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .timeline-section": {
      "margin-top": "28px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .section-line": {
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      gap: "12px",
      "margin-bottom": "14px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .section-line > span": {
      "font-size": "12px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .timeline": {
      position: "relative",
      height: "66px",
      border: "1px solid var(--line)",
      background: "var(--panel)",
      "border-radius": "5px",
      isolation: "isolate",
      "touch-action": "none",
      "user-select": "none",
      cursor: "crosshair",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .timeline canvas": {
      width: "100%",
      height: "100%",
      display: "block",
      opacity: "0.75",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .trim-selection": {
      position: "absolute",
      inset: "0",
      background: "color-mix(in srgb, var(--accent) 10%, transparent)",
      border: "1px solid var(--accent)",
      "pointer-events": "none",
    },
  } as Parameters<typeof css>[0]),
  css({
    '& .timeline input[type="range"]': {
      "z-index": "3",
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      margin: "0",
      padding: "0",
      background: "transparent",
      border: "0",
      appearance: "none",
      "pointer-events": "none",
    },
  } as Parameters<typeof css>[0]),
  css({
    '& .timeline input[type="range"]::-webkit-slider-thumb': {
      appearance: "none",
      width: "12px",
      height: "66px",
      background: "var(--accent)",
      border: "3px solid var(--bg)",
      "border-radius": "3px",
      "pointer-events": "auto",
      cursor: "ew-resize",
      "box-shadow": "0 0 0 1px var(--accent)",
    },
  } as Parameters<typeof css>[0]),
  css({
    '& .timeline input[type="range"]::-moz-range-thumb': {
      width: "8px",
      height: "60px",
      background: "var(--accent)",
      border: "2px solid var(--bg)",
      "border-radius": "3px",
      "pointer-events": "auto",
      cursor: "ew-resize",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #playhead": {
      "z-index": "2",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #playhead::-webkit-slider-thumb": {
      width: "2px",
      height: "76px",
      border: "0",
      "border-radius": "0",
      background: "var(--ink)",
      "box-shadow": "0 0 0 1px var(--bg)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #playhead::-moz-range-thumb": {
      width: "2px",
      height: "76px",
      border: "0",
      "border-radius": "0",
      background: "var(--ink)",
      "box-shadow": "0 0 0 1px var(--bg)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #current-time": {
      color: "var(--ink)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .time-ruler": {
      display: "flex",
      "justify-content": "space-between",
      "font-size": "11px",
      color: "var(--muted)",
      "font-variant-numeric": "tabular-nums",
      "margin-top": "7px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .trim-fields": {
      display: "grid",
      "grid-template-columns": "1fr 1fr auto",
      gap: "16px",
      "align-items": "end",
      "margin-top": "16px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .trim-fields label": {
      "font-size": "12px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .input-unit": {
      display: "flex",
      "align-items": "center",
      border: "1px solid var(--border)",
      "border-radius": "6px",
      "min-width": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .input-unit input": {
      border: "0",
      background: "transparent",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .input-unit > span": {
      "padding-right": "12px",
      color: "var(--muted)",
      "font-size": "12px",
      "font-weight": "400",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .input-unit:focus-within": {
      outline: "2px solid var(--muted)",
      "outline-offset": "3px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .input-unit input:focus-visible": {
      outline: "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .trim-fields button": {
      "font-size": "12px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .timeline-section > .hint": {
      "margin-top": "12px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& details": {
      "border-bottom": "1px solid var(--line)",
      "margin-top": "16px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& details label": {
      margin: "8px 0 16px",
      "font-size": "12px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .export-summary": {
      margin: "22px 0",
      display: "grid",
      gap: "12px",
      "font-size": "12px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .export-summary > div": {
      display: "flex",
      "justify-content": "space-between",
      gap: "8px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .export-summary dt": {
      color: "var(--muted)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .export-summary dd": {
      margin: "0",
      "text-align": "right",
      "font-variant-numeric": "tabular-nums",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #result": {
      "margin-top": "20px",
      "padding-top": "20px",
      "border-top": "1px solid var(--line)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #result strong": {
      display: "block",
      "font-size": "12px",
      "font-weight": "500",
      "margin-bottom": "10px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #result a": {
      width: "100%",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #result video": {
      width: "100%",
      "max-height": "360px",
      "object-fit": "contain",
      "margin-top": "12px",
      "border-radius": "4px",
      background: "#0c0a09",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .error": {
      padding: "12px 0 20px",
      color: "var(--error)",
      "font-size": "13px",
      "overflow-wrap": "anywhere",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .advanced-intro": {
      "max-width": "75ch",
      "margin-bottom": "24px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .advanced-intro p": {
      "margin-top": "8px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .favorite-row": {
      display: "flex",
      gap: "10px",
      "align-items": "end",
      "margin-bottom": "20px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .favorite-row label": {
      "max-width": "360px",
      flex: "1",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .advanced-actions": {
      display: "flex",
      "align-items": "center",
      gap: "12px",
      "margin-top": "12px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& code": {
      "font-size": "12px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& pre": {
      background: "var(--panel)",
      border: "1px solid var(--line)",
      padding: "18px",
      height: "245px",
      overflow: "auto",
      "border-radius": "6px",
      "font-size": "12px",
      "line-height": "1.6",
      "white-space": "pre-wrap",
      "overflow-wrap": "anywhere",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #advanced-result": {
      "margin-top": "24px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #advanced-image": {
      display: "block",
      "max-width": "100%",
      height: "auto",
      "max-height": "360px",
      "object-fit": "contain",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #advanced-video": {
      "max-height": "360px",
      "max-width": "100%",
      background: "#0c0a09",
      "border-radius": "6px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .skip-link": {
      position: "fixed",
      top: "8px",
      left: "8px",
      transform: "translateY(-200%)",
      "z-index": "10",
      background: "var(--bg)",
      padding: "12px",
      border: "1px solid var(--border)",
      "border-radius": "6px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .skip-link:focus": {
      transform: "translateY(0)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #result, & #advanced-result": {
      animation: "reveal 0.2s ease-out",
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (prefers-color-scheme: dark)": {
      "&": {
        "--bg": "#0c0a09",
        "--panel": "#1c1917",
        "--ink": "#f5f5f4",
        "--muted": "#a8a29e",
        "--line": "#292524",
        "--border": "#78716c",
        "--hover": "#292524",
        "--accent": "#93b4f7",
        "--selected": "#1e3a5f",
        "--error": "#fca5a5",
        "--on-primary": "#0c0a09",
      },
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (max-width: 800px)": {
      "& .preview": {
        height: "360px",
      },
      "& .file-info": {
        "flex-wrap": "wrap",
        gap: "4px",
      },
      "& .file-info span": {
        "margin-left": "0",
      },
      "& .file-info strong": {
        "max-width": "100%",
      },
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (max-width: 480px)": {
      "& .workspace": {
        padding: "0 16px",
        "margin-top": "24px",
      },
      "& .preview": {
        height: "260px",
      },
      "& .empty-state": {
        padding: "20px 12px",
        gap: "12px",
      },
      "& .empty-state .hint": {
        "font-size": "11px",
      },
      "& .preview-tools": {
        "flex-wrap": "wrap",
      },
      "& .preview-tools span": {
        "font-size": "11px",
      },
      "& .trim-fields": {
        "grid-template-columns": "1fr 1fr",
        gap: "12px",
      },
      "& .trim-fields button": {
        "grid-column": "1/-1",
        "justify-self": "start",
      },
      "& .four-fields": {
        "grid-template-columns": "1fr 1fr",
      },
      "& button, & input, & select, & .button": {
        "min-height": "44px",
      },
      "& .favorite-row": {
        "flex-wrap": "wrap",
      },
      "& .favorite-row label": {
        "flex-basis": "100%",
        "max-width": "none",
      },
      "& .advanced-actions": {
        "flex-wrap": "wrap",
      },
      "& .timeline-section": {
        "margin-top": "24px",
      },
      "& .file-info span": {
        "font-size": "11px",
      },
      "& .section-line": {
        gap: "6px",
      },
      "& .section-line > span": {
        "font-size": "11px",
      },
      "& #result-video": {
        "max-height": "240px",
      },
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (prefers-reduced-motion: reduce)": {
      "& *, & *::before, & *::after": {
        animation: "none !important",
        transition: "none !important",
        "scroll-behavior": "auto !important",
      },
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .sr-only": {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: "0",
      overflow: "hidden",
      "clip-path": "inset(50%)",
      "white-space": "nowrap",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .export-actions": {
      display: "flex",
      "align-items": "center",
      gap: "12px",
      "margin-top": "24px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .export-actions #cancel": {
      margin: "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #advanced-settings": {
      "margin-top": "28px",
      "border-top": "1px solid var(--line)",
      "border-bottom": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #advanced-settings > summary": {
      color: "var(--muted)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .advanced-controls": {
      padding: "8px 0 28px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #settings": {
      display: "grid",
      "grid-template-columns": "repeat(3, minmax(0, 1fr))",
      gap: "16px",
      "margin-top": "24px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #settings label": {
      margin: "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #ffmpeg-workspace": {
      "margin-top": "28px",
      "border-bottom": "0",
      "border-top": "1px solid var(--line)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .encode-position": {
      position: "absolute",
      inset: "0 auto 0 0",
      width: "0",
      "pointer-events": "none",
      overflow: "hidden",
      "z-index": "1",
      background: "color-mix(in srgb, var(--accent) 24%, transparent)",
      "border-right": "2px solid var(--accent)",
      transition: "width 180ms linear",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .encode-position::before": {
      content: '""',
      position: "absolute",
      bottom: "0",
      left: "0",
      right: "0",
      height: "4px",
      background: "var(--accent)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .encode-position::after": {
      content: '""',
      position: "absolute",
      top: "0",
      bottom: "0",
      width: "48px",
      background:
        "linear-gradient(100deg, transparent, #ffffff80, transparent)",
      animation: "encode-glint 1.8s ease-in-out infinite",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .job-status": {
      "margin-top": "12px",
      display: "grid",
      "grid-template-columns": "1fr auto",
      "align-items": "center",
      "column-gap": "16px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #status": {
      "grid-column": "1",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #elapsed": {
      "grid-column": "2",
      "font-variant-numeric": "tabular-nums",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #encoding-preview": {
      "grid-column": "1/-1",
      display: "flex",
      "align-items": "center",
      gap: "16px",
      "margin-top": "16px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #encoder-frame": {
      width: "auto",
      height: "auto",
      "max-width": "160px",
      "max-height": "110px",
      "border-radius": "4px",
      background: "#0c0a09",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #result": {
      "max-width": "640px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .diagnostics-footer": {
      "margin-block-start": "1.5rem",
      color: "var(--muted)",
      "font-size": "0.8125rem",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .diagnostics-footer label": {
      display: "flex",
      "align-items": "center",
      gap: "0.5rem",
      "min-height": "44px",
      cursor: "pointer",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .diagnostics-footer input": {
      width: "1rem",
      height: "1rem",
      "flex-shrink": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& #result a": {
      width: "auto",
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (max-width: 600px)": {
      "& #settings": {
        "grid-template-columns": "1fr 1fr",
      },
      "& .export-actions": {
        "flex-wrap": "wrap",
      },
      "& .preview-tools": {
        "flex-wrap": "wrap",
      },
      "& .trim-fields": {
        "grid-template-columns": "1fr 1fr",
      },
      "& .trim-fields button": {
        "grid-column": "1/-1",
        "justify-self": "start",
      },
    },
  } as Parameters<typeof css>[0]),
];
