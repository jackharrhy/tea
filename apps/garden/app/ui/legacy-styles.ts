// Migrated from the original site's compiled CSS. Keep visual changes separate from the port.
import { css } from "remix/component";
export const legacyStyles = css({
  "@layer theme": {
    "&, &": {
      "--font-sans":
        'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji",\n      "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
      "--font-serif":
        'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
      "--font-mono":
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",\n      "Courier New", monospace',
      "--color-red-500": "#c03e35",
      "--color-orange-200": "#f9ae77",
      "--color-orange-300": "#ec8b49",
      "--color-orange-400": "#da702c",
      "--color-black": "#100f0f",
      "--spacing": "0.25rem",
      "--text-sm": "0.875rem",
      "--text-sm--line-height": "calc(1.25 / 0.875)",
      "--text-xl": "1.25rem",
      "--text-xl--line-height": "calc(1.75 / 1.25)",
      "--text-2xl": "1.5rem",
      "--text-2xl--line-height": "calc(2 / 1.5)",
      "--text-3xl": "1.875rem",
      "--text-3xl--line-height": "calc(2.25 / 1.875)",
      "--font-weight-medium": "500",
      "--font-weight-semibold": "600",
      "--radius-md": "0.375rem",
      "--default-transition-duration": "150ms",
      "--default-transition-timing-function": "cubic-bezier(0.4, 0, 0.2, 1)",
      "--default-font-family": "var(--font-sans)",
      "--default-mono-font-family": "var(--font-mono)",
      "--color-paper": "#fffcf0",
      "--color-shade-200": "#cecdc3",
      "--color-shade-300": "#b7b5ac",
      "--color-shade-400": "#9f9d96",
      "--color-shade-500": "#878580",
      "--color-shade-800": "#403e3c",
      "--color-link": "#ea580c",
    },
  },
  "@layer base": {
    "& *, & ::after, & ::before, & ::backdrop, & ::file-selector-button": {
      "box-sizing": "border-box",
      margin: "0",
      padding: "0",
      border: "0 solid",
    },
    "&, &": {
      "line-height": "1.5",
      "-webkit-text-size-adjust": "100%",
      "tab-size": "4",
      "font-family":
        'var(--default-font-family, ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji")',
      "font-feature-settings": "var(--default-font-feature-settings, normal)",
      "font-variation-settings":
        "var(--default-font-variation-settings, normal)",
      "-webkit-tap-highlight-color": "transparent",
    },
    "& hr": {
      height: "0",
      color: "inherit",
      "border-top-width": "1px",
    },
    "& abbr:where([title])": {
      "-webkit-text-decoration": "underline dotted",
      "text-decoration": "underline dotted",
    },
    "& h1, & h2, & h3, & h4, & h5, & h6": {
      "font-size": "inherit",
      "font-weight": "inherit",
    },
    "& a": {
      color: "inherit",
      "-webkit-text-decoration": "inherit",
      "text-decoration": "inherit",
    },
    "& b, & strong": {
      "font-weight": "bolder",
    },
    "& code, & kbd, & samp, & pre": {
      "font-family":
        'var(--default-mono-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
      "font-feature-settings":
        "var(--default-mono-font-feature-settings, normal)",
      "font-variation-settings":
        "var(--default-mono-font-variation-settings, normal)",
      "font-size": "1em",
    },
    "& small": {
      "font-size": "80%",
    },
    "& sub, & sup": {
      "font-size": "75%",
      "line-height": "0",
      position: "relative",
      "vertical-align": "baseline",
    },
    "& sub": {
      bottom: "-0.25em",
    },
    "& sup": {
      top: "-0.5em",
    },
    "& table": {
      "text-indent": "0",
      "border-color": "inherit",
      "border-collapse": "collapse",
    },
    "& :-moz-focusring": {
      outline: "auto",
    },
    "& progress": {
      "vertical-align": "baseline",
    },
    "& summary": {
      display: "list-item",
    },
    "& ol, & ul, & menu": {
      "list-style": "none",
    },
    "& img, & svg, & video, & canvas, & audio, & iframe, & embed, & object": {
      display: "block",
      "vertical-align": "middle",
    },
    "& img, & video": {
      "max-width": "100%",
      height: "auto",
    },
    "& button, & input, & select, & optgroup, & textarea, & ::file-selector-button":
      {
        font: "inherit",
        "font-feature-settings": "inherit",
        "font-variation-settings": "inherit",
        "letter-spacing": "inherit",
        color: "inherit",
        "border-radius": "0",
        "background-color": "transparent",
        opacity: "1",
      },
    "& :where(select:is([multiple], [size])) optgroup": {
      "font-weight": "bolder",
    },
    "& :where(select:is([multiple], [size])) optgroup option": {
      "padding-inline-start": "20px",
    },
    "& ::file-selector-button": {
      "margin-inline-end": "4px",
    },
    "& ::placeholder": {
      opacity: "1",
    },
    "@supports (not (-webkit-appearance: -apple-pay-button))  or (contain-intrinsic-size: 1px)":
      {
        "& ::placeholder": {
          color: "currentcolor",
          "@supports (color: color-mix(in lab, red, red))": {
            color: "color-mix(in oklab, currentcolor 50%, transparent)",
          },
        },
      },
    "& textarea": {
      resize: "vertical",
    },
    "& ::-webkit-search-decoration": {
      "-webkit-appearance": "none",
    },
    "& ::-webkit-date-and-time-value": {
      "min-height": "1lh",
      "text-align": "inherit",
    },
    "& ::-webkit-datetime-edit": {
      display: "inline-flex",
    },
    "& ::-webkit-datetime-edit-fields-wrapper": {
      padding: "0",
    },
    "& ::-webkit-datetime-edit, & ::-webkit-datetime-edit-year-field, & ::-webkit-datetime-edit-month-field, & ::-webkit-datetime-edit-day-field, & ::-webkit-datetime-edit-hour-field, & ::-webkit-datetime-edit-minute-field, & ::-webkit-datetime-edit-second-field, & ::-webkit-datetime-edit-millisecond-field, & ::-webkit-datetime-edit-meridiem-field":
      {
        "padding-block": "0",
      },
    "& ::-webkit-calendar-picker-indicator": {
      "line-height": "1",
    },
    "& :-moz-ui-invalid": {
      "box-shadow": "none",
    },
    '& button, & input:where([type="button"], [type="reset"], [type="submit"]), & ::file-selector-button':
      {
        appearance: "button",
      },
    "& ::-webkit-inner-spin-button, & ::-webkit-outer-spin-button": {
      height: "auto",
    },
    '& [hidden]:where(:not([hidden="until-found"]))': {
      display: "none !important",
    },
  },
  "@layer utilities": {
    "& .absolute": {
      position: "absolute",
    },
    "& .relative": {
      position: "relative",
    },
    "& .top-8": {
      top: "calc(var(--spacing) * 8)",
    },
    "& .left-36": {
      left: "calc(var(--spacing) * 36)",
    },
    "& .container": {
      width: "100%",
      "@media (width >= 40rem)": {
        "max-width": "40rem",
      },
      "@media (width >= 48rem)": {
        "max-width": "48rem",
      },
      "@media (width >= 64rem)": {
        "max-width": "64rem",
      },
      "@media (width >= 80rem)": {
        "max-width": "80rem",
      },
      "@media (width >= 96rem)": {
        "max-width": "96rem",
      },
    },
    "& .m-0": {
      margin: "0",
    },
    "& .mx-2": {
      "margin-inline": "calc(var(--spacing) * 2)",
    },
    "& .mx-auto": {
      "margin-inline": "auto",
    },
    "& .my-0": {
      "margin-block": "0",
    },
    "& .my-7": {
      "margin-block": "calc(var(--spacing) * 7)",
    },
    "& .my-8": {
      "margin-block": "calc(var(--spacing) * 8)",
    },
    "& .my-10": {
      "margin-block": "calc(var(--spacing) * 10)",
    },
    "& .my-16": {
      "margin-block": "calc(var(--spacing) * 16)",
    },
    "& .prose": {
      color: "var(--tw-prose-body)",
      "max-width": "65ch",
      ':where(p):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "1.25em",
        "margin-bottom": "1.25em",
      },
      ':where([class~="lead"]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "var(--tw-prose-lead)",
          "font-size": "1.25em",
          "line-height": "1.6",
          "margin-top": "1.2em",
          "margin-bottom": "1.2em",
        },
      ':where(a):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        color: "var(--tw-prose-links)",
        "text-decoration": "underline",
        "font-weight": "500",
      },
      ':where(strong):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "var(--tw-prose-bold)",
          "font-weight": "600",
        },
      ':where(a strong):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "inherit",
        },
      ':where(blockquote strong):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "inherit",
        },
      ':where(thead th strong):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "inherit",
        },
      ':where(ol):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "list-style-type": "decimal",
        "margin-top": "1.25em",
        "margin-bottom": "1.25em",
        "padding-inline-start": "1.625em",
      },
      ':where(ol[type="A"]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "list-style-type": "upper-alpha",
        },
      ':where(ol[type="a"]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "list-style-type": "lower-alpha",
        },
      ':where(ol[type="A" s]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "list-style-type": "upper-alpha",
        },
      ':where(ol[type="a" s]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "list-style-type": "lower-alpha",
        },
      ':where(ol[type="I"]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "list-style-type": "upper-roman",
        },
      ':where(ol[type="i"]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "list-style-type": "lower-roman",
        },
      ':where(ol[type="I" s]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "list-style-type": "upper-roman",
        },
      ':where(ol[type="i" s]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "list-style-type": "lower-roman",
        },
      ':where(ol[type="1"]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "list-style-type": "decimal",
        },
      ':where(ul):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "list-style-type": "disc",
        "margin-top": "1.25em",
        "margin-bottom": "1.25em",
        "padding-inline-start": "1.625em",
      },
      ':where(ol > li):not(:where([class~="not-prose"], [class~="not-prose"] *))::marker':
        {
          "font-weight": "400",
          color: "var(--tw-prose-counters)",
        },
      ':where(ul > li):not(:where([class~="not-prose"], [class~="not-prose"] *))::marker':
        {
          color: "var(--tw-prose-bullets)",
        },
      ':where(dt):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        color: "var(--tw-prose-headings)",
        "font-weight": "600",
        "margin-top": "1.25em",
      },
      ':where(hr):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "border-color": "var(--tw-prose-hr)",
        "border-top-width": "1px",
        "margin-top": "3em",
        "margin-bottom": "3em",
      },
      ':where(blockquote):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "font-weight": "500",
          "font-style": "italic",
          color: "var(--tw-prose-quotes)",
          "border-inline-start-width": "0.25rem",
          "border-inline-start-color": "var(--tw-prose-quote-borders)",
          quotes: '"\\201C""\\201D""\\2018""\\2019"',
          "margin-top": "1.6em",
          "margin-bottom": "1.6em",
          "padding-inline-start": "1em",
        },
      ':where(blockquote p:first-of-type):not(:where([class~="not-prose"], [class~="not-prose"] *))::before':
        {
          content: "open-quote",
        },
      ':where(blockquote p:last-of-type):not(:where([class~="not-prose"], [class~="not-prose"] *))::after':
        {
          content: "close-quote",
        },
      ':where(h1):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        color: "var(--tw-prose-headings)",
        "font-weight": "800",
        "font-size": "2.25em",
        "margin-top": "0",
        "margin-bottom": "0.8888889em",
        "line-height": "1.1111111",
      },
      ':where(h1 strong):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "font-weight": "900",
          color: "inherit",
        },
      ':where(h2):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        color: "var(--tw-prose-headings)",
        "font-weight": "700",
        "font-size": "1.5em",
        "margin-top": "2em",
        "margin-bottom": "1em",
        "line-height": "1.3333333",
      },
      ':where(h2 strong):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "font-weight": "800",
          color: "inherit",
        },
      ':where(h3):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        color: "var(--tw-prose-headings)",
        "font-weight": "600",
        "font-size": "1.25em",
        "margin-top": "1.6em",
        "margin-bottom": "0.6em",
        "line-height": "1.6",
      },
      ':where(h3 strong):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "font-weight": "700",
          color: "inherit",
        },
      ':where(h4):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        color: "var(--tw-prose-headings)",
        "font-weight": "600",
        "margin-top": "1.5em",
        "margin-bottom": "0.5em",
        "line-height": "1.5",
      },
      ':where(h4 strong):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "font-weight": "700",
          color: "inherit",
        },
      ':where(img):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "2em",
        "margin-bottom": "2em",
      },
      ':where(picture):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          display: "block",
          "margin-top": "2em",
          "margin-bottom": "2em",
        },
      ':where(video):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "2em",
          "margin-bottom": "2em",
        },
      ':where(kbd):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "font-weight": "500",
        "font-family": "inherit",
        color: "var(--tw-prose-kbd)",
        "box-shadow":
          "0 0 0 1px var(--tw-prose-kbd-shadows), 0 3px 0 var(--tw-prose-kbd-shadows)",
        "font-size": "0.875em",
        "border-radius": "0.3125rem",
        "padding-top": "0.1875em",
        "padding-inline-end": "0.375em",
        "padding-bottom": "0.1875em",
        "padding-inline-start": "0.375em",
      },
      ':where(code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "var(--tw-prose-code)",
          "font-weight": "600",
          "font-size": "0.875em",
        },
      ':where(code):not(:where([class~="not-prose"], [class~="not-prose"] *))::before':
        {
          content: '"`"',
        },
      ':where(code):not(:where([class~="not-prose"], [class~="not-prose"] *))::after':
        {
          content: '"`"',
        },
      ':where(a code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "inherit",
        },
      ':where(h1 code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "inherit",
        },
      ':where(h2 code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "inherit",
          "font-size": "0.875em",
        },
      ':where(h3 code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "inherit",
          "font-size": "0.9em",
        },
      ':where(h4 code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "inherit",
        },
      ':where(blockquote code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "inherit",
        },
      ':where(thead th code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "inherit",
        },
      ':where(pre):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        color: "var(--tw-prose-pre-code)",
        "background-color": "var(--tw-prose-pre-bg)",
        "overflow-x": "auto",
        "font-weight": "400",
        "font-size": "0.875em",
        "line-height": "1.7142857",
        "margin-top": "1.7142857em",
        "margin-bottom": "1.7142857em",
        "border-radius": "0.375rem",
        "padding-top": "0.8571429em",
        "padding-inline-end": "1.1428571em",
        "padding-bottom": "0.8571429em",
        "padding-inline-start": "1.1428571em",
      },
      ':where(pre code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "background-color": "transparent",
          "border-width": "0",
          "border-radius": "0",
          padding: "0",
          "font-weight": "inherit",
          color: "inherit",
          "font-size": "inherit",
          "font-family": "inherit",
          "line-height": "inherit",
        },
      ':where(pre code):not(:where([class~="not-prose"], [class~="not-prose"] *))::before':
        {
          content: "none",
        },
      ':where(pre code):not(:where([class~="not-prose"], [class~="not-prose"] *))::after':
        {
          content: "none",
        },
      ':where(table):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          width: "100%",
          "table-layout": "auto",
          "margin-top": "2em",
          "margin-bottom": "2em",
          "font-size": "0.875em",
          "line-height": "1.7142857",
        },
      ':where(thead):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "border-bottom-width": "1px",
          "border-bottom-color": "var(--tw-prose-th-borders)",
        },
      ':where(thead th):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "var(--tw-prose-headings)",
          "font-weight": "600",
          "vertical-align": "bottom",
          "padding-inline-end": "0.5714286em",
          "padding-bottom": "0.5714286em",
          "padding-inline-start": "0.5714286em",
        },
      ':where(tbody tr):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "border-bottom-width": "1px",
          "border-bottom-color": "var(--tw-prose-td-borders)",
        },
      ':where(tbody tr:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "border-bottom-width": "0",
        },
      ':where(tbody td):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "vertical-align": "baseline",
        },
      ':where(tfoot):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "border-top-width": "1px",
          "border-top-color": "var(--tw-prose-th-borders)",
        },
      ':where(tfoot td):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "vertical-align": "top",
        },
      ':where(th, td):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "text-align": "start",
        },
      ':where(figure > *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
          "margin-bottom": "0",
        },
      ':where(figcaption):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          color: "var(--tw-prose-captions)",
          "font-size": "0.875em",
          "line-height": "1.4285714",
          "margin-top": "0.8571429em",
        },
      "--tw-prose-body": "oklch(37.3% 0.034 259.733)",
      "--tw-prose-headings": "oklch(21% 0.034 264.665)",
      "--tw-prose-lead": "oklch(44.6% 0.03 256.802)",
      "--tw-prose-links": "oklch(21% 0.034 264.665)",
      "--tw-prose-bold": "oklch(21% 0.034 264.665)",
      "--tw-prose-counters": "oklch(55.1% 0.027 264.364)",
      "--tw-prose-bullets": "oklch(87.2% 0.01 258.338)",
      "--tw-prose-hr": "oklch(92.8% 0.006 264.531)",
      "--tw-prose-quotes": "oklch(21% 0.034 264.665)",
      "--tw-prose-quote-borders": "oklch(92.8% 0.006 264.531)",
      "--tw-prose-captions": "oklch(55.1% 0.027 264.364)",
      "--tw-prose-kbd": "oklch(21% 0.034 264.665)",
      "--tw-prose-kbd-shadows":
        "color-mix(in oklab, oklch(21% 0.034 264.665) 10%, transparent)",
      "--tw-prose-code": "oklch(21% 0.034 264.665)",
      "--tw-prose-pre-code": "oklch(92.8% 0.006 264.531)",
      "--tw-prose-pre-bg": "oklch(27.8% 0.033 256.848)",
      "--tw-prose-th-borders": "oklch(87.2% 0.01 258.338)",
      "--tw-prose-td-borders": "oklch(92.8% 0.006 264.531)",
      "--tw-prose-invert-body": "oklch(87.2% 0.01 258.338)",
      "--tw-prose-invert-headings": "#fff",
      "--tw-prose-invert-lead": "oklch(70.7% 0.022 261.325)",
      "--tw-prose-invert-links": "#fff",
      "--tw-prose-invert-bold": "#fff",
      "--tw-prose-invert-counters": "oklch(70.7% 0.022 261.325)",
      "--tw-prose-invert-bullets": "oklch(44.6% 0.03 256.802)",
      "--tw-prose-invert-hr": "oklch(37.3% 0.034 259.733)",
      "--tw-prose-invert-quotes": "oklch(96.7% 0.003 264.542)",
      "--tw-prose-invert-quote-borders": "oklch(37.3% 0.034 259.733)",
      "--tw-prose-invert-captions": "oklch(70.7% 0.022 261.325)",
      "--tw-prose-invert-kbd": "#fff",
      "--tw-prose-invert-kbd-shadows": "rgb(255 255 255 / 10%)",
      "--tw-prose-invert-code": "#fff",
      "--tw-prose-invert-pre-code": "oklch(87.2% 0.01 258.338)",
      "--tw-prose-invert-pre-bg": "rgb(0 0 0 / 50%)",
      "--tw-prose-invert-th-borders": "oklch(44.6% 0.03 256.802)",
      "--tw-prose-invert-td-borders": "oklch(37.3% 0.034 259.733)",
      "font-size": "1rem",
      "line-height": "1.75",
      ':where(picture > img):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
          "margin-bottom": "0",
        },
      ':where(li):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "0.5em",
        "margin-bottom": "0.5em",
      },
      ':where(ol > li):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-start": "0.375em",
        },
      ':where(ul > li):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-start": "0.375em",
        },
      ':where(.prose > ul > li p):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0.75em",
          "margin-bottom": "0.75em",
        },
      ':where(.prose > ul > li > p:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "1.25em",
        },
      ':where(.prose > ul > li > p:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-bottom": "1.25em",
        },
      ':where(.prose > ol > li > p:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "1.25em",
        },
      ':where(.prose > ol > li > p:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-bottom": "1.25em",
        },
      ':where(ul ul, ul ol, ol ul, ol ol):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0.75em",
          "margin-bottom": "0.75em",
        },
      ':where(dl):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "1.25em",
        "margin-bottom": "1.25em",
      },
      ':where(dd):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "0.5em",
        "padding-inline-start": "1.625em",
      },
      ':where(hr + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
        },
      ':where(h2 + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
        },
      ':where(h3 + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
        },
      ':where(h4 + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
        },
      ':where(thead th:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-start": "0",
        },
      ':where(thead th:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-end": "0",
        },
      ':where(tbody td, tfoot td):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-top": "0.5714286em",
          "padding-inline-end": "0.5714286em",
          "padding-bottom": "0.5714286em",
          "padding-inline-start": "0.5714286em",
        },
      ':where(tbody td:first-child, tfoot td:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-start": "0",
        },
      ':where(tbody td:last-child, tfoot td:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-end": "0",
        },
      ':where(figure):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "2em",
          "margin-bottom": "2em",
        },
      ':where(.prose > :first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
        },
      ':where(.prose > :last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-bottom": "0",
        },
    },
    "& .prose-lg": {
      "font-size": "1.125rem",
      "line-height": "1.7777778",
      ':where(p):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "1.3333333em",
        "margin-bottom": "1.3333333em",
      },
      ':where([class~="lead"]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "font-size": "1.2222222em",
          "line-height": "1.4545455",
          "margin-top": "1.0909091em",
          "margin-bottom": "1.0909091em",
        },
      ':where(blockquote):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "1.6666667em",
          "margin-bottom": "1.6666667em",
          "padding-inline-start": "1em",
        },
      ':where(h1):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "font-size": "2.6666667em",
        "margin-top": "0",
        "margin-bottom": "0.8333333em",
        "line-height": "1",
      },
      ':where(h2):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "font-size": "1.6666667em",
        "margin-top": "1.8666667em",
        "margin-bottom": "1.0666667em",
        "line-height": "1.3333333",
      },
      ':where(h3):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "font-size": "1.3333333em",
        "margin-top": "1.6666667em",
        "margin-bottom": "0.6666667em",
        "line-height": "1.5",
      },
      ':where(h4):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "1.7777778em",
        "margin-bottom": "0.4444444em",
        "line-height": "1.5555556",
      },
      ':where(img):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "1.7777778em",
        "margin-bottom": "1.7777778em",
      },
      ':where(picture):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "1.7777778em",
          "margin-bottom": "1.7777778em",
        },
      ':where(picture > img):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
          "margin-bottom": "0",
        },
      ':where(video):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "1.7777778em",
          "margin-bottom": "1.7777778em",
        },
      ':where(kbd):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "font-size": "0.8888889em",
        "border-radius": "0.3125rem",
        "padding-top": "0.2222222em",
        "padding-inline-end": "0.4444444em",
        "padding-bottom": "0.2222222em",
        "padding-inline-start": "0.4444444em",
      },
      ':where(code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "font-size": "0.8888889em",
        },
      ':where(h2 code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "font-size": "0.8666667em",
        },
      ':where(h3 code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "font-size": "0.875em",
        },
      ':where(pre):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "font-size": "0.8888889em",
        "line-height": "1.75",
        "margin-top": "2em",
        "margin-bottom": "2em",
        "border-radius": "0.375rem",
        "padding-top": "1em",
        "padding-inline-end": "1.5em",
        "padding-bottom": "1em",
        "padding-inline-start": "1.5em",
      },
      ':where(ol):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "1.3333333em",
        "margin-bottom": "1.3333333em",
        "padding-inline-start": "1.5555556em",
      },
      ':where(ul):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "1.3333333em",
        "margin-bottom": "1.3333333em",
        "padding-inline-start": "1.5555556em",
      },
      ':where(li):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "0.6666667em",
        "margin-bottom": "0.6666667em",
      },
      ':where(ol > li):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-start": "0.4444444em",
        },
      ':where(ul > li):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-start": "0.4444444em",
        },
      ':where(.prose-lg > ul > li p):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0.8888889em",
          "margin-bottom": "0.8888889em",
        },
      ':where(.prose-lg > ul > li > p:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "1.3333333em",
        },
      ':where(.prose-lg > ul > li > p:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-bottom": "1.3333333em",
        },
      ':where(.prose-lg > ol > li > p:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "1.3333333em",
        },
      ':where(.prose-lg > ol > li > p:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-bottom": "1.3333333em",
        },
      ':where(ul ul, ul ol, ol ul, ol ol):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0.8888889em",
          "margin-bottom": "0.8888889em",
        },
      ':where(dl):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "1.3333333em",
        "margin-bottom": "1.3333333em",
      },
      ':where(dt):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "1.3333333em",
      },
      ':where(dd):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "0.6666667em",
        "padding-inline-start": "1.5555556em",
      },
      ':where(hr):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
        "margin-top": "3.1111111em",
        "margin-bottom": "3.1111111em",
      },
      ':where(hr + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
        },
      ':where(h2 + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
        },
      ':where(h3 + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
        },
      ':where(h4 + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
        },
      ':where(table):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "font-size": "0.8888889em",
          "line-height": "1.5",
        },
      ':where(thead th):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-end": "0.75em",
          "padding-bottom": "0.75em",
          "padding-inline-start": "0.75em",
        },
      ':where(thead th:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-start": "0",
        },
      ':where(thead th:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-end": "0",
        },
      ':where(tbody td, tfoot td):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-top": "0.75em",
          "padding-inline-end": "0.75em",
          "padding-bottom": "0.75em",
          "padding-inline-start": "0.75em",
        },
      ':where(tbody td:first-child, tfoot td:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-start": "0",
        },
      ':where(tbody td:last-child, tfoot td:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "padding-inline-end": "0",
        },
      ':where(figure):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "1.7777778em",
          "margin-bottom": "1.7777778em",
        },
      ':where(figure > *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
          "margin-bottom": "0",
        },
      ':where(figcaption):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "font-size": "0.8888889em",
          "line-height": "1.5",
          "margin-top": "1em",
        },
      ':where(.prose-lg > :first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-top": "0",
        },
      ':where(.prose-lg > :last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
        {
          "margin-bottom": "0",
        },
    },
    "& .mt-4": {
      "margin-top": "calc(var(--spacing) * 4)",
    },
    "& .mb-2": {
      "margin-bottom": "calc(var(--spacing) * 2)",
    },
    "& .mb-3": {
      "margin-bottom": "calc(var(--spacing) * 3)",
    },
    "& .mb-4": {
      "margin-bottom": "calc(var(--spacing) * 4)",
    },
    "& .mb-8": {
      "margin-bottom": "calc(var(--spacing) * 8)",
    },
    "& .mb-10": {
      "margin-bottom": "calc(var(--spacing) * 10)",
    },
    "& .ml-8": {
      "margin-left": "calc(var(--spacing) * 8)",
    },
    "& .block": {
      display: "block",
    },
    "& .contents": {
      display: "contents",
    },
    "& .flex": {
      display: "flex",
    },
    "& .hidden": {
      display: "none",
    },
    "& .inline": {
      display: "inline",
    },
    "& .inline-block": {
      display: "inline-block",
    },
    "& .inline-flex": {
      display: "inline-flex",
    },
    "& .aspect-\\[12\\/9\\]": {
      "aspect-ratio": "12/9",
    },
    "& .h-16": {
      height: "calc(var(--spacing) * 16)",
    },
    "& .h-full": {
      height: "100%",
    },
    "& .min-h-full": {
      "min-height": "100%",
    },
    "& .w-16": {
      width: "calc(var(--spacing) * 16)",
    },
    "& .w-32": {
      width: "calc(var(--spacing) * 32)",
    },
    "& .w-\\[12rem\\]": {
      width: "12rem",
    },
    "& .w-full": {
      width: "100%",
    },
    "& .max-w-\\[65ch\\]": {
      "max-width": "65ch",
    },
    "& .max-w-\\[65ch\\]\\!": {
      "max-width": "65ch !important",
    },
    "& .max-w-full": {
      "max-width": "100%",
    },
    "& .max-w-none": {
      "max-width": "none",
    },
    "& .flex-1": {
      flex: "1",
    },
    "& .flex-shrink": {
      "flex-shrink": "1",
    },
    "& .flex-shrink-0": {
      "flex-shrink": "0",
    },
    "& .transform": {
      transform:
        "var(--tw-rotate-x,) var(--tw-rotate-y,) var(--tw-rotate-z,) var(--tw-skew-x,) var(--tw-skew-y,)",
    },
    "& .resize": {
      resize: "both",
    },
    "& .flex-col": {
      "flex-direction": "column",
    },
    "& .items-center": {
      "align-items": "center",
    },
    "& .justify-between": {
      "justify-content": "space-between",
    },
    "& .justify-center": {
      "justify-content": "center",
    },
    "& .gap-3": {
      gap: "calc(var(--spacing) * 3)",
    },
    "& .gap-4": {
      gap: "calc(var(--spacing) * 4)",
    },
    "& .gap-6": {
      gap: "calc(var(--spacing) * 6)",
    },
    "& .rounded": {
      "border-radius": "0.25rem",
    },
    "& .rounded-md": {
      "border-radius": "var(--radius-md)",
    },
    "& .border": {
      "border-style": "var(--tw-border-style)",
      "border-width": "1px",
    },
    "& .border-2": {
      "border-style": "var(--tw-border-style)",
      "border-width": "2px",
    },
    "& .border-t-2": {
      "border-top-style": "var(--tw-border-style)",
      "border-top-width": "2px",
    },
    "& .border-b-2": {
      "border-bottom-style": "var(--tw-border-style)",
      "border-bottom-width": "2px",
    },
    "& .border-dashed": {
      "--tw-border-style": "dashed",
      "border-style": "dashed",
    },
    "& .border-shade-200": {
      "border-color": "var(--color-shade-200)",
    },
    "& .border-shade-300": {
      "border-color": "var(--color-shade-300)",
    },
    "& .bg-black": {
      "background-color": "var(--color-black)",
    },
    "& .bg-orange-300\\/20": {
      "background-color": "color-mix(in srgb, #ec8b49 20%, transparent)",
      "@supports (color: color-mix(in lab, red, red))": {
        "background-color":
          "color-mix(in oklab, var(--color-orange-300) 20%, transparent)",
      },
    },
    "& .bg-paper": {
      "background-color": "var(--color-paper)",
    },
    "& .object-cover": {
      "object-fit": "cover",
    },
    "& .p-1": {
      padding: "var(--spacing)",
    },
    "& .p-4": {
      padding: "calc(var(--spacing) * 4)",
    },
    "& .px-4": {
      "padding-inline": "calc(var(--spacing) * 4)",
    },
    "& .px-8": {
      "padding-inline": "calc(var(--spacing) * 8)",
    },
    "& .py-2": {
      "padding-block": "calc(var(--spacing) * 2)",
    },
    "& .py-8": {
      "padding-block": "calc(var(--spacing) * 8)",
    },
    "& .py-10": {
      "padding-block": "calc(var(--spacing) * 10)",
    },
    "& .pt-4": {
      "padding-top": "calc(var(--spacing) * 4)",
    },
    "& .pt-12": {
      "padding-top": "calc(var(--spacing) * 12)",
    },
    "& .pb-6": {
      "padding-bottom": "calc(var(--spacing) * 6)",
    },
    "& .pb-8": {
      "padding-bottom": "calc(var(--spacing) * 8)",
    },
    "& .pb-\\[0\\.1rem\\]": {
      "padding-bottom": "0.1rem",
    },
    "& .text-center": {
      "text-align": "center",
    },
    "& .text-right": {
      "text-align": "right",
    },
    "& .font-mono": {
      "font-family": "var(--font-mono)",
    },
    "& .font-serif": {
      "font-family": "var(--font-serif)",
    },
    "& .\\!text-3xl": {
      "font-size": "var(--text-3xl) !important",
      "line-height":
        "var(--tw-leading, var(--text-3xl--line-height)) !important",
    },
    "& .text-2xl": {
      "font-size": "var(--text-2xl)",
      "line-height": "var(--tw-leading, var(--text-2xl--line-height))",
    },
    "& .text-sm": {
      "font-size": "var(--text-sm)",
      "line-height": "var(--tw-leading, var(--text-sm--line-height))",
    },
    "& .text-xl": {
      "font-size": "var(--text-xl)",
      "line-height": "var(--tw-leading, var(--text-xl--line-height))",
    },
    "& .text-\\[\\.9rem\\]": {
      "font-size": ".9rem",
    },
    "& .text-\\[0\\.8rem\\]": {
      "font-size": "0.8rem",
    },
    "& .text-\\[0\\.9em\\]": {
      "font-size": "0.9em",
    },
    "& .text-\\[1\\.1em\\]": {
      "font-size": "1.1em",
    },
    "& .text-\\[1\\.1rem\\]": {
      "font-size": "1.1rem",
    },
    "& .leading-none": {
      "--tw-leading": "1",
      "line-height": "1",
    },
    "& .font-medium": {
      "--tw-font-weight": "var(--font-weight-medium)",
      "font-weight": "var(--font-weight-medium)",
    },
    "& .font-semibold": {
      "--tw-font-weight": "var(--font-weight-semibold)",
      "font-weight": "var(--font-weight-semibold)",
    },
    "& .text-balance": {
      "text-wrap": "balance",
    },
    "& .text-\\[\\#374151\\]": {
      color: "#374151",
    },
    "& .text-\\[var\\(--tw-prose-links\\)\\]": {
      color: "var(--tw-prose-links)",
    },
    "& .text-black": {
      color: "var(--color-black)",
    },
    "& .text-red-500": {
      color: "var(--color-red-500)",
    },
    "& .text-shade-500": {
      color: "var(--color-shade-500)",
    },
    "& .text-shade-800": {
      color: "var(--color-shade-800)",
    },
    "& .italic": {
      "font-style": "italic",
    },
    "& .no-underline": {
      "text-decoration-line": "none",
    },
    "& .underline": {
      "text-decoration-line": "underline",
    },
    "& .invert": {
      "--tw-invert": "invert(100%)",
      filter:
        "var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)",
    },
    "& .transition": {
      "transition-property":
        "color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to, opacity, box-shadow, transform, translate, scale, rotate, filter, -webkit-backdrop-filter, backdrop-filter, display, content-visibility, overlay, pointer-events",
      "transition-timing-function":
        "var(--tw-ease, var(--default-transition-timing-function))",
      "transition-duration":
        "var(--tw-duration, var(--default-transition-duration))",
    },
    "& .prose-invert": {
      "--tw-prose-body": "var(--tw-prose-invert-body)",
      "--tw-prose-headings": "var(--tw-prose-invert-headings)",
      "--tw-prose-lead": "var(--tw-prose-invert-lead)",
      "--tw-prose-links": "var(--tw-prose-invert-links)",
      "--tw-prose-bold": "var(--tw-prose-invert-bold)",
      "--tw-prose-counters": "var(--tw-prose-invert-counters)",
      "--tw-prose-bullets": "var(--tw-prose-invert-bullets)",
      "--tw-prose-hr": "var(--tw-prose-invert-hr)",
      "--tw-prose-quotes": "var(--tw-prose-invert-quotes)",
      "--tw-prose-quote-borders": "var(--tw-prose-invert-quote-borders)",
      "--tw-prose-captions": "var(--tw-prose-invert-captions)",
      "--tw-prose-kbd": "var(--tw-prose-invert-kbd)",
      "--tw-prose-kbd-shadows": "var(--tw-prose-invert-kbd-shadows)",
      "--tw-prose-code": "var(--tw-prose-invert-code)",
      "--tw-prose-pre-code": "var(--tw-prose-invert-pre-code)",
      "--tw-prose-pre-bg": "var(--tw-prose-invert-pre-bg)",
      "--tw-prose-th-borders": "var(--tw-prose-invert-th-borders)",
      "--tw-prose-td-borders": "var(--tw-prose-invert-td-borders)",
    },
    "& .prose-orange": {
      "--tw-prose-links": "var(--color-link)",
      "--tw-prose-invert-links": "var(--color-orange-400)",
    },
    "& .placeholder\\:text-shade-400": {
      "&::placeholder": {
        color: "var(--color-shade-400)",
      },
    },
    "& .last\\:mb-0": {
      "&:last-child": {
        "margin-bottom": "0",
      },
    },
    "& .last\\:border-b-0": {
      "&:last-child": {
        "border-bottom-style": "var(--tw-border-style)",
        "border-bottom-width": "0px",
      },
    },
    "& .hover\\:bg-orange-200\\/40": {
      "&:hover": {
        "@media (hover: hover)": {
          "background-color": "color-mix(in srgb, #f9ae77 40%, transparent)",
          "@supports (color: color-mix(in lab, red, red))": {
            "background-color":
              "color-mix(in oklab, var(--color-orange-200) 40%, transparent)",
          },
        },
      },
    },
    "& .hover\\:underline": {
      "&:hover": {
        "@media (hover: hover)": {
          "text-decoration-line": "underline",
        },
      },
    },
    "& .focus\\:border-orange-300": {
      "&:focus": {
        "border-color": "var(--color-orange-300)",
      },
    },
    "& .focus\\:outline-none": {
      "&:focus": {
        "--tw-outline-style": "none",
        "outline-style": "none",
      },
    },
    "& .disabled\\:cursor-not-allowed": {
      "&:disabled": {
        cursor: "not-allowed",
      },
    },
    "& .disabled\\:opacity-50": {
      "&:disabled": {
        opacity: "50%",
      },
    },
    "& .sm\\:block": {
      "@media (width >= 40rem)": {
        display: "block",
      },
    },
    "& .md\\:prose-lg": {
      "@media (width >= 48rem)": {
        "font-size": "1.125rem",
        "line-height": "1.7777778",
        ':where(p):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
          "margin-top": "1.3333333em",
          "margin-bottom": "1.3333333em",
        },
        ':where([class~="lead"]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "1.2222222em",
            "line-height": "1.4545455",
            "margin-top": "1.0909091em",
            "margin-bottom": "1.0909091em",
          },
        ':where(blockquote):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.6666667em",
            "margin-bottom": "1.6666667em",
            "padding-inline-start": "1em",
          },
        ':where(h1):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "2.6666667em",
            "margin-top": "0",
            "margin-bottom": "0.8333333em",
            "line-height": "1",
          },
        ':where(h2):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "1.6666667em",
            "margin-top": "1.8666667em",
            "margin-bottom": "1.0666667em",
            "line-height": "1.3333333",
          },
        ':where(h3):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "1.3333333em",
            "margin-top": "1.6666667em",
            "margin-bottom": "0.6666667em",
            "line-height": "1.5",
          },
        ':where(h4):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.7777778em",
            "margin-bottom": "0.4444444em",
            "line-height": "1.5555556",
          },
        ':where(img):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.7777778em",
            "margin-bottom": "1.7777778em",
          },
        ':where(picture):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.7777778em",
            "margin-bottom": "1.7777778em",
          },
        ':where(picture > img):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
            "margin-bottom": "0",
          },
        ':where(video):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.7777778em",
            "margin-bottom": "1.7777778em",
          },
        ':where(kbd):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.8888889em",
            "border-radius": "0.3125rem",
            "padding-top": "0.2222222em",
            "padding-inline-end": "0.4444444em",
            "padding-bottom": "0.2222222em",
            "padding-inline-start": "0.4444444em",
          },
        ':where(code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.8888889em",
          },
        ':where(h2 code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.8666667em",
          },
        ':where(h3 code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.875em",
          },
        ':where(pre):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.8888889em",
            "line-height": "1.75",
            "margin-top": "2em",
            "margin-bottom": "2em",
            "border-radius": "0.375rem",
            "padding-top": "1em",
            "padding-inline-end": "1.5em",
            "padding-bottom": "1em",
            "padding-inline-start": "1.5em",
          },
        ':where(ol):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.3333333em",
            "margin-bottom": "1.3333333em",
            "padding-inline-start": "1.5555556em",
          },
        ':where(ul):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.3333333em",
            "margin-bottom": "1.3333333em",
            "padding-inline-start": "1.5555556em",
          },
        ':where(li):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0.6666667em",
            "margin-bottom": "0.6666667em",
          },
        ':where(ol > li):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-start": "0.4444444em",
          },
        ':where(ul > li):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-start": "0.4444444em",
          },
        ':where(.md\\:prose-lg > ul > li p):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0.8888889em",
            "margin-bottom": "0.8888889em",
          },
        ':where(.md\\:prose-lg > ul > li > p:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.3333333em",
          },
        ':where(.md\\:prose-lg > ul > li > p:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-bottom": "1.3333333em",
          },
        ':where(.md\\:prose-lg > ol > li > p:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.3333333em",
          },
        ':where(.md\\:prose-lg > ol > li > p:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-bottom": "1.3333333em",
          },
        ':where(ul ul, ul ol, ol ul, ol ol):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0.8888889em",
            "margin-bottom": "0.8888889em",
          },
        ':where(dl):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.3333333em",
            "margin-bottom": "1.3333333em",
          },
        ':where(dt):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.3333333em",
          },
        ':where(dd):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0.6666667em",
            "padding-inline-start": "1.5555556em",
          },
        ':where(hr):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "3.1111111em",
            "margin-bottom": "3.1111111em",
          },
        ':where(hr + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
          },
        ':where(h2 + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
          },
        ':where(h3 + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
          },
        ':where(h4 + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
          },
        ':where(table):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.8888889em",
            "line-height": "1.5",
          },
        ':where(thead th):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-end": "0.75em",
            "padding-bottom": "0.75em",
            "padding-inline-start": "0.75em",
          },
        ':where(thead th:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-start": "0",
          },
        ':where(thead th:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-end": "0",
          },
        ':where(tbody td, tfoot td):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-top": "0.75em",
            "padding-inline-end": "0.75em",
            "padding-bottom": "0.75em",
            "padding-inline-start": "0.75em",
          },
        ':where(tbody td:first-child, tfoot td:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-start": "0",
          },
        ':where(tbody td:last-child, tfoot td:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-end": "0",
          },
        ':where(figure):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.7777778em",
            "margin-bottom": "1.7777778em",
          },
        ':where(figure > *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
            "margin-bottom": "0",
          },
        ':where(figcaption):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.8888889em",
            "line-height": "1.5",
            "margin-top": "1em",
          },
        ':where(.md\\:prose-lg > :first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
          },
        ':where(.md\\:prose-lg > :last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-bottom": "0",
          },
      },
    },
    "& .lg\\:-left-20": {
      "@media (width >= 64rem)": {
        left: "calc(var(--spacing) * -20)",
      },
    },
    "& .lg\\:prose-xl": {
      "@media (width >= 64rem)": {
        "font-size": "1.25rem",
        "line-height": "1.8",
        ':where(p):not(:where([class~="not-prose"], [class~="not-prose"] *))': {
          "margin-top": "1.2em",
          "margin-bottom": "1.2em",
        },
        ':where([class~="lead"]):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "1.2em",
            "line-height": "1.5",
            "margin-top": "1em",
            "margin-bottom": "1em",
          },
        ':where(blockquote):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.6em",
            "margin-bottom": "1.6em",
            "padding-inline-start": "1.0666667em",
          },
        ':where(h1):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "2.8em",
            "margin-top": "0",
            "margin-bottom": "0.8571429em",
            "line-height": "1",
          },
        ':where(h2):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "1.8em",
            "margin-top": "1.5555556em",
            "margin-bottom": "0.8888889em",
            "line-height": "1.1111111",
          },
        ':where(h3):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "1.5em",
            "margin-top": "1.6em",
            "margin-bottom": "0.6666667em",
            "line-height": "1.3333333",
          },
        ':where(h4):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.8em",
            "margin-bottom": "0.6em",
            "line-height": "1.6",
          },
        ':where(img):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "2em",
            "margin-bottom": "2em",
          },
        ':where(picture):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "2em",
            "margin-bottom": "2em",
          },
        ':where(picture > img):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
            "margin-bottom": "0",
          },
        ':where(video):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "2em",
            "margin-bottom": "2em",
          },
        ':where(kbd):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.9em",
            "border-radius": "0.3125rem",
            "padding-top": "0.25em",
            "padding-inline-end": "0.4em",
            "padding-bottom": "0.25em",
            "padding-inline-start": "0.4em",
          },
        ':where(code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.9em",
          },
        ':where(h2 code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.8611111em",
          },
        ':where(h3 code):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.9em",
          },
        ':where(pre):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.9em",
            "line-height": "1.7777778",
            "margin-top": "2em",
            "margin-bottom": "2em",
            "border-radius": "0.5rem",
            "padding-top": "1.1111111em",
            "padding-inline-end": "1.3333333em",
            "padding-bottom": "1.1111111em",
            "padding-inline-start": "1.3333333em",
          },
        ':where(ol):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.2em",
            "margin-bottom": "1.2em",
            "padding-inline-start": "1.6em",
          },
        ':where(ul):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.2em",
            "margin-bottom": "1.2em",
            "padding-inline-start": "1.6em",
          },
        ':where(li):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0.6em",
            "margin-bottom": "0.6em",
          },
        ':where(ol > li):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-start": "0.4em",
          },
        ':where(ul > li):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-start": "0.4em",
          },
        ':where(.lg\\:prose-xl > ul > li p):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0.8em",
            "margin-bottom": "0.8em",
          },
        ':where(.lg\\:prose-xl > ul > li > p:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.2em",
          },
        ':where(.lg\\:prose-xl > ul > li > p:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-bottom": "1.2em",
          },
        ':where(.lg\\:prose-xl > ol > li > p:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.2em",
          },
        ':where(.lg\\:prose-xl > ol > li > p:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-bottom": "1.2em",
          },
        ':where(ul ul, ul ol, ol ul, ol ol):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0.8em",
            "margin-bottom": "0.8em",
          },
        ':where(dl):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.2em",
            "margin-bottom": "1.2em",
          },
        ':where(dt):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "1.2em",
          },
        ':where(dd):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0.6em",
            "padding-inline-start": "1.6em",
          },
        ':where(hr):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "2.8em",
            "margin-bottom": "2.8em",
          },
        ':where(hr + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
          },
        ':where(h2 + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
          },
        ':where(h3 + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
          },
        ':where(h4 + *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
          },
        ':where(table):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.9em",
            "line-height": "1.5555556",
          },
        ':where(thead th):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-end": "0.6666667em",
            "padding-bottom": "0.8888889em",
            "padding-inline-start": "0.6666667em",
          },
        ':where(thead th:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-start": "0",
          },
        ':where(thead th:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-end": "0",
          },
        ':where(tbody td, tfoot td):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-top": "0.8888889em",
            "padding-inline-end": "0.6666667em",
            "padding-bottom": "0.8888889em",
            "padding-inline-start": "0.6666667em",
          },
        ':where(tbody td:first-child, tfoot td:first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-start": "0",
          },
        ':where(tbody td:last-child, tfoot td:last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "padding-inline-end": "0",
          },
        ':where(figure):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "2em",
            "margin-bottom": "2em",
          },
        ':where(figure > *):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
            "margin-bottom": "0",
          },
        ':where(figcaption):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "font-size": "0.9em",
            "line-height": "1.5555556",
            "margin-top": "1em",
          },
        ':where(.lg\\:prose-xl > :first-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-top": "0",
          },
        ':where(.lg\\:prose-xl > :last-child):not(:where([class~="not-prose"], [class~="not-prose"] *))':
          {
            "margin-bottom": "0",
          },
      },
    },
    "& .prose-p\\:mt-0": {
      '& :is(:where(p):not(:where([class~="not-prose"],[class~="not-prose"] *)))':
        {
          "margin-top": "0",
        },
    },
    "& .prose-p\\:mb-4": {
      '& :is(:where(p):not(:where([class~="not-prose"],[class~="not-prose"] *)))':
        {
          "margin-bottom": "calc(var(--spacing) * 4)",
        },
    },
    "& .prose-li\\:my-0": {
      '& :is(:where(li):not(:where([class~="not-prose"],[class~="not-prose"] *)))':
        {
          "margin-block": "0",
        },
    },
  },
  "& .prose blockquote p:first-of-type::before": {
    content: "none",
  },
  "& .prose blockquote p:last-of-type::after": {
    content: "none",
  },
  "& .astro-code .line": {
    "white-space": "pre",
  },
  "& .quake-page": {
    "background-image": 'url("/images/quake-bg.png")',
  },
  "& .quake-page div > p": {
    position: "relative",
    "padding-left": "1rem",
  },
  "& .quake-page div > p::before": {
    content: '"•"',
    position: "absolute",
    left: "0",
    top: "0.125rem",
  },
  "@layer properties": {
    "@supports ((-webkit-hyphens: none) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color:rgb(from red r g b))))":
      {
        "& *, & ::before, & ::after, & ::backdrop": {
          "--tw-rotate-x": "initial",
          "--tw-rotate-y": "initial",
          "--tw-rotate-z": "initial",
          "--tw-skew-x": "initial",
          "--tw-skew-y": "initial",
          "--tw-border-style": "solid",
          "--tw-leading": "initial",
          "--tw-font-weight": "initial",
          "--tw-blur": "initial",
          "--tw-brightness": "initial",
          "--tw-contrast": "initial",
          "--tw-grayscale": "initial",
          "--tw-hue-rotate": "initial",
          "--tw-invert": "initial",
          "--tw-opacity": "initial",
          "--tw-saturate": "initial",
          "--tw-sepia": "initial",
          "--tw-drop-shadow": "initial",
          "--tw-drop-shadow-color": "initial",
          "--tw-drop-shadow-alpha": "100%",
          "--tw-drop-shadow-size": "initial",
        },
      },
  },
} as Parameters<typeof css>[0]);
