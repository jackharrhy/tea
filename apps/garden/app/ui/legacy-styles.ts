// Migrated from the deployed Astro CSS. Rule order and rounded values preserve visual parity.
import { css } from "remix/component";
export const legacyStyles = [
  css({
    "@media (prefers-reduced-motion)": {
      "& ::view-transition-group(*), & ::view-transition-old(*), & ::view-transition-new(*), & [data-astro-transition-scope]":
        {
          animation: "none !important",
        },
    },
  } as Parameters<typeof css>[0]),
  css({
    "@supports (((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b))))":
      {
        "& *, & :before, & :after, & ::backdrop": {
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
  } as Parameters<typeof css>[0]),
  css({
    "&, &": {
      "--font-sans":
        'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
      "--font-serif":
        'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
      "--font-mono":
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      "--color-red-500": "#c03e35",
      "--color-orange-200": "#f9ae77",
      "--color-orange-300": "#ec8b49",
      "--color-orange-400": "#da702c",
      "--color-black": "#100f0f",
      "--spacing": ".25rem",
      "--text-sm": ".875rem",
      "--text-sm--line-height": "calc(1.25 / .875)",
      "--text-xl": "1.25rem",
      "--text-xl--line-height": "calc(1.75 / 1.25)",
      "--text-2xl": "1.5rem",
      "--text-2xl--line-height": "calc(2 / 1.5)",
      "--text-3xl": "1.875rem",
      "--text-3xl--line-height": "calc(2.25 / 1.875)",
      "--font-weight-medium": "500",
      "--font-weight-semibold": "600",
      "--radius-md": ".375rem",
      "--default-transition-duration": ".15s",
      "--default-transition-timing-function": "cubic-bezier(.4, 0, .2, 1)",
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
  } as Parameters<typeof css>[0]),
  css({
    "& *, & :after, & :before, & ::backdrop": {
      "box-sizing": "border-box",
      border: "0 solid",
      margin: "0",
      padding: "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::file-selector-button": {
      "box-sizing": "border-box",
      border: "0 solid",
      margin: "0",
      padding: "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "&, &": {
      "-webkit-text-size-adjust": "100%",
      "tab-size": "4",
      "line-height": "1.5",
      "font-family":
        'var(--default-font-family,ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji")',
      "font-feature-settings": "var(--default-font-feature-settings,normal)",
      "font-variation-settings":
        "var(--default-font-variation-settings,normal)",
      "-webkit-tap-highlight-color": "transparent",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& hr": {
      height: "0",
      color: "inherit",
      "border-top-width": "1px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& abbr:where([title])": {
      "text-decoration": "underline dotted",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& h1, & h2, & h3, & h4, & h5, & h6": {
      "font-size": "inherit",
      "font-weight": "inherit",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& a": {
      color: "inherit",
      "-webkit-text-decoration": "inherit",
      "text-decoration": "inherit",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& b, & strong": {
      "font-weight": "bolder",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& code, & kbd, & samp, & pre": {
      "font-family":
        'var(--default-mono-font-family,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
      "font-feature-settings":
        "var(--default-mono-font-feature-settings,normal)",
      "font-variation-settings":
        "var(--default-mono-font-variation-settings,normal)",
      "font-size": "1em",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& small": {
      "font-size": "80%",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& sub, & sup": {
      "vertical-align": "baseline",
      "font-size": "75%",
      "line-height": "0",
      position: "relative",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& sub": {
      bottom: "-.25em",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& sup": {
      top: "-.5em",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& table": {
      "text-indent": "0",
      "border-color": "inherit",
      "border-collapse": "collapse",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& :-moz-focusring": {
      outline: "auto",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& progress": {
      "vertical-align": "baseline",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& summary": {
      display: "list-item",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ol, & ul, & menu": {
      "list-style": "none",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& img, & svg, & video, & canvas, & audio, & iframe, & embed, & object": {
      "vertical-align": "middle",
      display: "block",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& img, & video": {
      "max-width": "100%",
      height: "auto",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& button, & input, & select, & optgroup, & textarea": {
      font: "inherit",
      "font-feature-settings": "inherit",
      "font-variation-settings": "inherit",
      "letter-spacing": "inherit",
      color: "inherit",
      opacity: "1",
      "background-color": "#0000",
      "border-radius": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::file-selector-button": {
      font: "inherit",
      "font-feature-settings": "inherit",
      "font-variation-settings": "inherit",
      "letter-spacing": "inherit",
      color: "inherit",
      opacity: "1",
      "background-color": "#0000",
      "border-radius": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& :where(select:is([multiple],[size])) optgroup": {
      "font-weight": "bolder",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& :where(select:is([multiple],[size])) optgroup option": {
      "padding-inline-start": "20px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::file-selector-button": {
      "margin-inline-end": "4px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::placeholder": {
      opacity: "1",
    },
  } as Parameters<typeof css>[0]),
  css({
    "@supports (not ((-webkit-appearance:-apple-pay-button))) or (contain-intrinsic-size:1px)":
      {
        "& ::placeholder": {
          color: "currentColor",
        },
        "@supports (color:color-mix(in lab, red, red))": {
          "& ::placeholder": {
            color: "color-mix(in oklab, currentcolor 50%, transparent)",
          },
        },
      },
  } as Parameters<typeof css>[0]),
  css({
    "& textarea": {
      resize: "vertical",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-search-decoration": {
      "-webkit-appearance": "none",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-date-and-time-value": {
      "min-height": "1lh",
      "text-align": "inherit",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-datetime-edit": {
      display: "inline-flex",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-datetime-edit-fields-wrapper": {
      padding: "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-datetime-edit": {
      "padding-block": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-datetime-edit-year-field": {
      "padding-block": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-datetime-edit-month-field": {
      "padding-block": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-datetime-edit-day-field": {
      "padding-block": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-datetime-edit-hour-field": {
      "padding-block": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-datetime-edit-minute-field": {
      "padding-block": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-datetime-edit-second-field": {
      "padding-block": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-datetime-edit-millisecond-field": {
      "padding-block": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-datetime-edit-meridiem-field": {
      "padding-block": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-calendar-picker-indicator": {
      "line-height": "1",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& :-moz-ui-invalid": {
      "box-shadow": "none",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& button, & input:where([type=button],[type=reset],[type=submit])": {
      appearance: "button",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::file-selector-button": {
      appearance: "button",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-inner-spin-button": {
      height: "auto",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& ::-webkit-outer-spin-button": {
      height: "auto",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& [hidden]:where(:not([hidden=until-found]))": {
      display: "none !important",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .absolute": {
      position: "absolute",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .relative": {
      position: "relative",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .top-8": {
      top: "calc(var(--spacing) * 8)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .left-36": {
      left: "calc(var(--spacing) * 36)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .container": {
      width: "100%",
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (width>=40rem)": {
      "& .container": {
        "max-width": "40rem",
      },
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (width>=48rem)": {
      "& .container": {
        "max-width": "48rem",
      },
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (width>=64rem)": {
      "& .container": {
        "max-width": "64rem",
      },
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (width>=80rem)": {
      "& .container": {
        "max-width": "80rem",
      },
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (width>=96rem)": {
      "& .container": {
        "max-width": "96rem",
      },
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .m-0": {
      margin: "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .mx-2": {
      "margin-inline": "calc(var(--spacing) * 2)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .mx-auto": {
      "margin-inline": "auto",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .my-0": {
      "margin-block": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .my-7": {
      "margin-block": "calc(var(--spacing) * 7)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .my-8": {
      "margin-block": "calc(var(--spacing) * 8)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .my-10": {
      "margin-block": "calc(var(--spacing) * 10)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .my-16": {
      "margin-block": "calc(var(--spacing) * 16)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose": {
      color: "var(--tw-prose-body)",
      "max-width": "65ch",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(p):not(:where([class~=not-prose],[class~=not-prose] *))": {
      "margin-top": "1.25em",
      "margin-bottom": "1.25em",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where([class~=lead]):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-lead)",
        "margin-top": "1.2em",
        "margin-bottom": "1.2em",
        "font-size": "1.25em",
        "line-height": "1.6",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(a):not(:where([class~=not-prose],[class~=not-prose] *))": {
      color: "var(--tw-prose-links)",
      "font-weight": "500",
      "text-decoration": "underline",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(strong):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-bold)",
        "font-weight": "600",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(a strong):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose :where(blockquote strong):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose :where(thead th strong):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "inherit",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ol):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.25em",
        "margin-bottom": "1.25em",
        "padding-inline-start": "1.625em",
        "list-style-type": "decimal",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ol[type=A]):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "list-style-type": "upper-alpha",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ol[type=a]):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "list-style-type": "lower-alpha",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ol[type=A s]):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "list-style-type": "upper-alpha",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ol[type=a s]):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "list-style-type": "lower-alpha",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ol[type=I]):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "list-style-type": "upper-roman",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ol[type=i]):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "list-style-type": "lower-roman",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ol[type=I s]):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "list-style-type": "upper-roman",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ol[type=i s]):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "list-style-type": "lower-roman",
      },
  } as Parameters<typeof css>[0]),
  css({
    '& .prose :where(ol[type="1"]):not(:where([class~=not-prose],[class~=not-prose] *))':
      {
        "list-style-type": "decimal",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ul):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.25em",
        "margin-bottom": "1.25em",
        "padding-inline-start": "1.625em",
        "list-style-type": "disc",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ol>li):not(:where([class~=not-prose],[class~=not-prose] *))::marker":
      {
        color: "var(--tw-prose-counters)",
        "font-weight": "400",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ul>li):not(:where([class~=not-prose],[class~=not-prose] *))::marker":
      {
        color: "var(--tw-prose-bullets)",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(dt):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-headings)",
        "margin-top": "1.25em",
        "font-weight": "600",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(hr):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "border-color": "var(--tw-prose-hr)",
        "border-top-width": "1px",
        "margin-top": "3em",
        "margin-bottom": "3em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(blockquote):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-quotes)",
        "border-inline-start-width": ".25rem",
        "border-inline-start-color": "var(--tw-prose-quote-borders)",
        quotes: '"“""”""‘""’"',
        "margin-top": "1.6em",
        "margin-bottom": "1.6em",
        "padding-inline-start": "1em",
        "font-style": "italic",
        "font-weight": "500",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(blockquote p:first-of-type):not(:where([class~=not-prose],[class~=not-prose] *)):before":
      {
        content: "open-quote",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(blockquote p:last-of-type):not(:where([class~=not-prose],[class~=not-prose] *)):after":
      {
        content: "close-quote",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(h1):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-headings)",
        "margin-top": "0",
        "margin-bottom": ".888889em",
        "font-size": "2.25em",
        "font-weight": "800",
        "line-height": "1.11111",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(h1 strong):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "inherit",
        "font-weight": "900",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(h2):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-headings)",
        "margin-top": "2em",
        "margin-bottom": "1em",
        "font-size": "1.5em",
        "font-weight": "700",
        "line-height": "1.33333",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(h2 strong):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "inherit",
        "font-weight": "800",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(h3):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-headings)",
        "margin-top": "1.6em",
        "margin-bottom": ".6em",
        "font-size": "1.25em",
        "font-weight": "600",
        "line-height": "1.6",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(h3 strong):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "inherit",
        "font-weight": "700",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(h4):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-headings)",
        "margin-top": "1.5em",
        "margin-bottom": ".5em",
        "font-weight": "600",
        "line-height": "1.5",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(h4 strong):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "inherit",
        "font-weight": "700",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(img):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "2em",
        "margin-bottom": "2em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(picture):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "2em",
        "margin-bottom": "2em",
        display: "block",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(video):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "2em",
        "margin-bottom": "2em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(kbd):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-kbd)",
        "box-shadow":
          "0 0 0 1px var(--tw-prose-kbd-shadows), 0 3px 0 var(--tw-prose-kbd-shadows)",
        "padding-top": ".1875em",
        "padding-inline-end": ".375em",
        "padding-bottom": ".1875em",
        "border-radius": ".3125rem",
        "padding-inline-start": ".375em",
        "font-family": "inherit",
        "font-size": ".875em",
        "font-weight": "500",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(code):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-code)",
        "font-size": ".875em",
        "font-weight": "600",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(code):not(:where([class~=not-prose],[class~=not-prose] *)):before, & .prose :where(code):not(:where([class~=not-prose],[class~=not-prose] *)):after":
      {
        content: '"`"',
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(a code):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose :where(h1 code):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "inherit",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(h2 code):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "inherit",
        "font-size": ".875em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(h3 code):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "inherit",
        "font-size": ".9em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(h4 code):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose :where(blockquote code):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose :where(thead th code):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "inherit",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(pre):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-pre-code)",
        "background-color": "var(--tw-prose-pre-bg)",
        "padding-top": ".857143em",
        "padding-inline-end": "1.14286em",
        "padding-bottom": ".857143em",
        "border-radius": ".375rem",
        "margin-top": "1.71429em",
        "margin-bottom": "1.71429em",
        "padding-inline-start": "1.14286em",
        "font-size": ".875em",
        "font-weight": "400",
        "line-height": "1.71429",
        "overflow-x": "auto",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(pre code):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "font-weight": "inherit",
        color: "inherit",
        "font-size": "inherit",
        "font-family": "inherit",
        "line-height": "inherit",
        "background-color": "#0000",
        "border-width": "0",
        "border-radius": "0",
        padding: "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(pre code):not(:where([class~=not-prose],[class~=not-prose] *)):before, & .prose :where(pre code):not(:where([class~=not-prose],[class~=not-prose] *)):after":
      {
        content: "none",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(table):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "table-layout": "auto",
        width: "100%",
        "margin-top": "2em",
        "margin-bottom": "2em",
        "font-size": ".875em",
        "line-height": "1.71429",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(thead):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "border-bottom-width": "1px",
        "border-bottom-color": "var(--tw-prose-th-borders)",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(thead th):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-headings)",
        "vertical-align": "bottom",
        "padding-inline-end": ".571429em",
        "padding-bottom": ".571429em",
        "padding-inline-start": ".571429em",
        "font-weight": "600",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(tbody tr):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "border-bottom-width": "1px",
        "border-bottom-color": "var(--tw-prose-td-borders)",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(tbody tr:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "border-bottom-width": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(tbody td):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "vertical-align": "baseline",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(tfoot):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "border-top-width": "1px",
        "border-top-color": "var(--tw-prose-th-borders)",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(tfoot td):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "vertical-align": "top",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(th,td):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "text-align": "start",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(figure>*):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "0",
        "margin-bottom": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(figcaption):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        color: "var(--tw-prose-captions)",
        "margin-top": ".857143em",
        "font-size": ".875em",
        "line-height": "1.42857",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose": {
      "--tw-prose-body": "oklch(37.3% .034 259.733)",
      "--tw-prose-headings": "oklch(21% .034 264.665)",
      "--tw-prose-lead": "oklch(44.6% .03 256.802)",
      "--tw-prose-links": "oklch(21% .034 264.665)",
      "--tw-prose-bold": "oklch(21% .034 264.665)",
      "--tw-prose-counters": "oklch(55.1% .027 264.364)",
      "--tw-prose-bullets": "oklch(87.2% .01 258.338)",
      "--tw-prose-hr": "oklch(92.8% .006 264.531)",
      "--tw-prose-quotes": "oklch(21% .034 264.665)",
      "--tw-prose-quote-borders": "oklch(92.8% .006 264.531)",
      "--tw-prose-captions": "oklch(55.1% .027 264.364)",
      "--tw-prose-kbd": "oklch(21% .034 264.665)",
      "--tw-prose-kbd-shadows": "oklab(21% -.00316127 -.0338527/.1)",
      "--tw-prose-code": "oklch(21% .034 264.665)",
      "--tw-prose-pre-code": "oklch(92.8% .006 264.531)",
      "--tw-prose-pre-bg": "oklch(27.8% .033 256.848)",
      "--tw-prose-th-borders": "oklch(87.2% .01 258.338)",
      "--tw-prose-td-borders": "oklch(92.8% .006 264.531)",
      "--tw-prose-invert-body": "oklch(87.2% .01 258.338)",
      "--tw-prose-invert-headings": "#fff",
      "--tw-prose-invert-lead": "oklch(70.7% .022 261.325)",
      "--tw-prose-invert-links": "#fff",
      "--tw-prose-invert-bold": "#fff",
      "--tw-prose-invert-counters": "oklch(70.7% .022 261.325)",
      "--tw-prose-invert-bullets": "oklch(44.6% .03 256.802)",
      "--tw-prose-invert-hr": "oklch(37.3% .034 259.733)",
      "--tw-prose-invert-quotes": "oklch(96.7% .003 264.542)",
      "--tw-prose-invert-quote-borders": "oklch(37.3% .034 259.733)",
      "--tw-prose-invert-captions": "oklch(70.7% .022 261.325)",
      "--tw-prose-invert-kbd": "#fff",
      "--tw-prose-invert-kbd-shadows": "#ffffff1a",
      "--tw-prose-invert-code": "#fff",
      "--tw-prose-invert-pre-code": "oklch(87.2% .01 258.338)",
      "--tw-prose-invert-pre-bg": "#00000080",
      "--tw-prose-invert-th-borders": "oklch(44.6% .03 256.802)",
      "--tw-prose-invert-td-borders": "oklch(37.3% .034 259.733)",
      "font-size": "1rem",
      "line-height": "1.75",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(picture>img):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "0",
        "margin-bottom": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(li):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": ".5em",
        "margin-bottom": ".5em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ol>li):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose :where(ul>li):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-inline-start": ".375em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(.prose>ul>li p):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": ".75em",
        "margin-bottom": ".75em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(.prose>ul>li>p:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.25em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(.prose>ul>li>p:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-bottom": "1.25em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(.prose>ol>li>p:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.25em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(.prose>ol>li>p:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-bottom": "1.25em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(ul ul,ul ol,ol ul,ol ol):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": ".75em",
        "margin-bottom": ".75em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(dl):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.25em",
        "margin-bottom": "1.25em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(dd):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": ".5em",
        "padding-inline-start": "1.625em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(hr+*):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose :where(h2+*):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose :where(h3+*):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose :where(h4+*):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(thead th:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-inline-start": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(thead th:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-inline-end": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(tbody td,tfoot td):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-top": ".571429em",
        "padding-inline-end": ".571429em",
        "padding-bottom": ".571429em",
        "padding-inline-start": ".571429em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(tbody td:first-child,tfoot td:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-inline-start": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(tbody td:last-child,tfoot td:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-inline-end": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(figure):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "2em",
        "margin-bottom": "2em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(.prose>:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose :where(.prose>:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-bottom": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg": {
      "font-size": "1.125rem",
      "line-height": "1.77778",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(p):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.33333em",
        "margin-bottom": "1.33333em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where([class~=lead]):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.09091em",
        "margin-bottom": "1.09091em",
        "font-size": "1.22222em",
        "line-height": "1.45455",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(blockquote):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.66667em",
        "margin-bottom": "1.66667em",
        "padding-inline-start": "1em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(h1):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "0",
        "margin-bottom": ".833333em",
        "font-size": "2.66667em",
        "line-height": "1",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(h2):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.86667em",
        "margin-bottom": "1.06667em",
        "font-size": "1.66667em",
        "line-height": "1.33333",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(h3):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.66667em",
        "margin-bottom": ".666667em",
        "font-size": "1.33333em",
        "line-height": "1.5",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(h4):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.77778em",
        "margin-bottom": ".444444em",
        "line-height": "1.55556",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(img):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose-lg :where(picture):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.77778em",
        "margin-bottom": "1.77778em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(picture>img):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "0",
        "margin-bottom": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(video):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.77778em",
        "margin-bottom": "1.77778em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(kbd):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-top": ".222222em",
        "padding-inline-end": ".444444em",
        "padding-bottom": ".222222em",
        "border-radius": ".3125rem",
        "padding-inline-start": ".444444em",
        "font-size": ".888889em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(code):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "font-size": ".888889em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(h2 code):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "font-size": ".866667em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(h3 code):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "font-size": ".875em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(pre):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-top": "1em",
        "padding-inline-end": "1.5em",
        "padding-bottom": "1em",
        "border-radius": ".375rem",
        "margin-top": "2em",
        "margin-bottom": "2em",
        "padding-inline-start": "1.5em",
        "font-size": ".888889em",
        "line-height": "1.75",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(ol):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose-lg :where(ul):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.33333em",
        "margin-bottom": "1.33333em",
        "padding-inline-start": "1.55556em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(li):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": ".666667em",
        "margin-bottom": ".666667em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(ol>li):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose-lg :where(ul>li):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-inline-start": ".444444em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(.prose-lg>ul>li p):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": ".888889em",
        "margin-bottom": ".888889em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(.prose-lg>ul>li>p:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.33333em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(.prose-lg>ul>li>p:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-bottom": "1.33333em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(.prose-lg>ol>li>p:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.33333em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(.prose-lg>ol>li>p:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-bottom": "1.33333em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(ul ul,ul ol,ol ul,ol ol):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": ".888889em",
        "margin-bottom": ".888889em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(dl):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.33333em",
        "margin-bottom": "1.33333em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(dt):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.33333em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(dd):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": ".666667em",
        "padding-inline-start": "1.55556em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(hr):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "3.11111em",
        "margin-bottom": "3.11111em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(hr+*):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose-lg :where(h2+*):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose-lg :where(h3+*):not(:where([class~=not-prose],[class~=not-prose] *)), & .prose-lg :where(h4+*):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(table):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "font-size": ".888889em",
        "line-height": "1.5",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(thead th):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-inline-end": ".75em",
        "padding-bottom": ".75em",
        "padding-inline-start": ".75em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(thead th:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-inline-start": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(thead th:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-inline-end": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(tbody td,tfoot td):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-top": ".75em",
        "padding-inline-end": ".75em",
        "padding-bottom": ".75em",
        "padding-inline-start": ".75em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(tbody td:first-child,tfoot td:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-inline-start": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(tbody td:last-child,tfoot td:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "padding-inline-end": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(figure):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1.77778em",
        "margin-bottom": "1.77778em",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(figure>*):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "0",
        "margin-bottom": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(figcaption):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "1em",
        "font-size": ".888889em",
        "line-height": "1.5",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(.prose-lg>:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-lg :where(.prose-lg>:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-bottom": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .mt-4": {
      "margin-top": "calc(var(--spacing) * 4)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .mb-2": {
      "margin-bottom": "calc(var(--spacing) * 2)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .mb-3": {
      "margin-bottom": "calc(var(--spacing) * 3)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .mb-4": {
      "margin-bottom": "calc(var(--spacing) * 4)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .mb-8": {
      "margin-bottom": "calc(var(--spacing) * 8)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .mb-10": {
      "margin-bottom": "calc(var(--spacing) * 10)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .ml-8": {
      "margin-left": "calc(var(--spacing) * 8)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .block": {
      display: "block",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .contents": {
      display: "contents",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .flex": {
      display: "flex",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .hidden": {
      display: "none",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .inline": {
      display: "inline",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .inline-block": {
      display: "inline-block",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .inline-flex": {
      display: "inline-flex",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .aspect-\\[12\\/9\\]": {
      "aspect-ratio": "12/9",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .h-16": {
      height: "calc(var(--spacing) * 16)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .h-full": {
      height: "100%",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .min-h-full": {
      "min-height": "100%",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .w-16": {
      width: "calc(var(--spacing) * 16)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .w-32": {
      width: "calc(var(--spacing) * 32)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .w-\\[12rem\\]": {
      width: "12rem",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .w-full": {
      width: "100%",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .max-w-\\[65ch\\]": {
      "max-width": "65ch",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .max-w-\\[65ch\\]\\!": {
      "max-width": "65ch !important",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .max-w-full": {
      "max-width": "100%",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .max-w-none": {
      "max-width": "none",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .flex-1": {
      flex: "1",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .flex-shrink": {
      "flex-shrink": "1",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .flex-shrink-0": {
      "flex-shrink": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .transform": {
      transform:
        "var(--tw-rotate-x,) var(--tw-rotate-y,) var(--tw-rotate-z,) var(--tw-skew-x,) var(--tw-skew-y,)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .resize": {
      resize: "both",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .flex-col": {
      "flex-direction": "column",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .items-center": {
      "align-items": "center",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .justify-between": {
      "justify-content": "space-between",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .justify-center": {
      "justify-content": "center",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .gap-3": {
      gap: "calc(var(--spacing) * 3)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .gap-4": {
      gap: "calc(var(--spacing) * 4)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .gap-6": {
      gap: "calc(var(--spacing) * 6)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .rounded": {
      "border-radius": ".25rem",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .rounded-md": {
      "border-radius": "var(--radius-md)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .border": {
      "border-style": "var(--tw-border-style)",
      "border-width": "1px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .border-2": {
      "border-style": "var(--tw-border-style)",
      "border-width": "2px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .border-t-2": {
      "border-top-style": "var(--tw-border-style)",
      "border-top-width": "2px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .border-b-2": {
      "border-bottom-style": "var(--tw-border-style)",
      "border-bottom-width": "2px",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .border-dashed": {
      "--tw-border-style": "dashed",
      "border-style": "dashed",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .border-shade-200": {
      "border-color": "var(--color-shade-200)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .border-shade-300": {
      "border-color": "var(--color-shade-300)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .bg-black": {
      "background-color": "var(--color-black)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .bg-orange-300\\/20": {
      "background-color": "#ec8b4933",
    },
  } as Parameters<typeof css>[0]),
  css({
    "@supports (color:color-mix(in lab, red, red))": {
      "& .bg-orange-300\\/20": {
        "background-color":
          "color-mix(in oklab, var(--color-orange-300) 20%, transparent)",
      },
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .bg-paper": {
      "background-color": "var(--color-paper)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .object-cover": {
      "object-fit": "cover",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .p-1": {
      padding: "var(--spacing)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .p-4": {
      padding: "calc(var(--spacing) * 4)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .px-4": {
      "padding-inline": "calc(var(--spacing) * 4)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .px-8": {
      "padding-inline": "calc(var(--spacing) * 8)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .py-2": {
      "padding-block": "calc(var(--spacing) * 2)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .py-8": {
      "padding-block": "calc(var(--spacing) * 8)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .py-10": {
      "padding-block": "calc(var(--spacing) * 10)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .pt-4": {
      "padding-top": "calc(var(--spacing) * 4)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .pt-12": {
      "padding-top": "calc(var(--spacing) * 12)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .pb-6": {
      "padding-bottom": "calc(var(--spacing) * 6)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .pb-8": {
      "padding-bottom": "calc(var(--spacing) * 8)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .pb-\\[0\\.1rem\\]": {
      "padding-bottom": ".1rem",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-center": {
      "text-align": "center",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-right": {
      "text-align": "right",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .font-mono": {
      "font-family": "var(--font-mono)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .font-serif": {
      "font-family": "var(--font-serif)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .\\!text-3xl": {
      "font-size": "var(--text-3xl) !important",
      "line-height":
        "var(--tw-leading,var(--text-3xl--line-height)) !important",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-2xl": {
      "font-size": "var(--text-2xl)",
      "line-height": "var(--tw-leading,var(--text-2xl--line-height))",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-sm": {
      "font-size": "var(--text-sm)",
      "line-height": "var(--tw-leading,var(--text-sm--line-height))",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-xl": {
      "font-size": "var(--text-xl)",
      "line-height": "var(--tw-leading,var(--text-xl--line-height))",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-\\[\\.9rem\\]": {
      "font-size": ".9rem",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-\\[0\\.8rem\\]": {
      "font-size": ".8rem",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-\\[0\\.9em\\]": {
      "font-size": ".9em",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-\\[1\\.1em\\]": {
      "font-size": "1.1em",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-\\[1\\.1rem\\]": {
      "font-size": "1.1rem",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .leading-none": {
      "--tw-leading": "1",
      "line-height": "1",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .font-medium": {
      "--tw-font-weight": "var(--font-weight-medium)",
      "font-weight": "var(--font-weight-medium)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .font-semibold": {
      "--tw-font-weight": "var(--font-weight-semibold)",
      "font-weight": "var(--font-weight-semibold)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-balance": {
      "text-wrap": "balance",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-\\[\\#374151\\]": {
      color: "#374151",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-\\[var\\(--tw-prose-links\\)\\]": {
      color: "var(--tw-prose-links)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-black": {
      color: "var(--color-black)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-red-500": {
      color: "var(--color-red-500)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-shade-500": {
      color: "var(--color-shade-500)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .text-shade-800": {
      color: "var(--color-shade-800)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .italic": {
      "font-style": "italic",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .no-underline": {
      "text-decoration-line": "none",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .underline": {
      "text-decoration-line": "underline",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .invert": {
      "--tw-invert": "invert(100%)",
      filter:
        "var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .transition": {
      "transition-property":
        "color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to,opacity,box-shadow,transform,translate,scale,rotate,filter,backdrop-filter,display,content-visibility,overlay,pointer-events",
      "transition-timing-function":
        "var(--tw-ease,var(--default-transition-timing-function))",
      "transition-duration":
        "var(--tw-duration,var(--default-transition-duration))",
    },
  } as Parameters<typeof css>[0]),
  css({
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
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-orange": {
      "--tw-prose-links": "var(--color-link)",
      "--tw-prose-invert-links": "var(--color-orange-400)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .placeholder\\:text-shade-400::placeholder": {
      color: "var(--color-shade-400)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .last\\:mb-0:last-child": {
      "margin-bottom": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .last\\:border-b-0:last-child": {
      "border-bottom-style": "var(--tw-border-style)",
      "border-bottom-width": "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (hover:hover)": {
      "& .hover\\:bg-orange-200\\/40:hover": {
        "background-color": "#f9ae7766",
      },
      "@supports (color:color-mix(in lab, red, red))": {
        "& .hover\\:bg-orange-200\\/40:hover": {
          "background-color":
            "color-mix(in oklab, var(--color-orange-200) 40%, transparent)",
        },
      },
      "& .hover\\:underline:hover": {
        "text-decoration-line": "underline",
      },
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .focus\\:border-orange-300:focus": {
      "border-color": "var(--color-orange-300)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .focus\\:outline-none:focus": {
      "--tw-outline-style": "none",
      "outline-style": "none",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .disabled\\:cursor-not-allowed:disabled": {
      cursor: "not-allowed",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .disabled\\:opacity-50:disabled": {
      opacity: ".5",
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (width>=40rem)": {
      "& .sm\\:block": {
        display: "block",
      },
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (width>=48rem)": {
      "& .md\\:prose-lg": {
        "font-size": "1.125rem",
        "line-height": "1.77778",
      },
      "& .md\\:prose-lg :where(p):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.33333em",
          "margin-bottom": "1.33333em",
        },
      "& .md\\:prose-lg :where([class~=lead]):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.09091em",
          "margin-bottom": "1.09091em",
          "font-size": "1.22222em",
          "line-height": "1.45455",
        },
      "& .md\\:prose-lg :where(blockquote):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.66667em",
          "margin-bottom": "1.66667em",
          "padding-inline-start": "1em",
        },
      "& .md\\:prose-lg :where(h1):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "0",
          "margin-bottom": ".833333em",
          "font-size": "2.66667em",
          "line-height": "1",
        },
      "& .md\\:prose-lg :where(h2):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.86667em",
          "margin-bottom": "1.06667em",
          "font-size": "1.66667em",
          "line-height": "1.33333",
        },
      "& .md\\:prose-lg :where(h3):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.66667em",
          "margin-bottom": ".666667em",
          "font-size": "1.33333em",
          "line-height": "1.5",
        },
      "& .md\\:prose-lg :where(h4):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.77778em",
          "margin-bottom": ".444444em",
          "line-height": "1.55556",
        },
      "& .md\\:prose-lg :where(img):not(:where([class~=not-prose],[class~=not-prose] *)), & .md\\:prose-lg :where(picture):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.77778em",
          "margin-bottom": "1.77778em",
        },
      "& .md\\:prose-lg :where(picture>img):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "0",
          "margin-bottom": "0",
        },
      "& .md\\:prose-lg :where(video):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.77778em",
          "margin-bottom": "1.77778em",
        },
      "& .md\\:prose-lg :where(kbd):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-top": ".222222em",
          "padding-inline-end": ".444444em",
          "padding-bottom": ".222222em",
          "border-radius": ".3125rem",
          "padding-inline-start": ".444444em",
          "font-size": ".888889em",
        },
      "& .md\\:prose-lg :where(code):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "font-size": ".888889em",
        },
      "& .md\\:prose-lg :where(h2 code):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "font-size": ".866667em",
        },
      "& .md\\:prose-lg :where(h3 code):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "font-size": ".875em",
        },
      "& .md\\:prose-lg :where(pre):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-top": "1em",
          "padding-inline-end": "1.5em",
          "padding-bottom": "1em",
          "border-radius": ".375rem",
          "margin-top": "2em",
          "margin-bottom": "2em",
          "padding-inline-start": "1.5em",
          "font-size": ".888889em",
          "line-height": "1.75",
        },
      "& .md\\:prose-lg :where(ol):not(:where([class~=not-prose],[class~=not-prose] *)), & .md\\:prose-lg :where(ul):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.33333em",
          "margin-bottom": "1.33333em",
          "padding-inline-start": "1.55556em",
        },
      "& .md\\:prose-lg :where(li):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": ".666667em",
          "margin-bottom": ".666667em",
        },
      "& .md\\:prose-lg :where(ol>li):not(:where([class~=not-prose],[class~=not-prose] *)), & .md\\:prose-lg :where(ul>li):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-inline-start": ".444444em",
        },
      "& .md\\:prose-lg :where(.md\\:prose-lg>ul>li p):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": ".888889em",
          "margin-bottom": ".888889em",
        },
      "& .md\\:prose-lg :where(.md\\:prose-lg>ul>li>p:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.33333em",
        },
      "& .md\\:prose-lg :where(.md\\:prose-lg>ul>li>p:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-bottom": "1.33333em",
        },
      "& .md\\:prose-lg :where(.md\\:prose-lg>ol>li>p:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.33333em",
        },
      "& .md\\:prose-lg :where(.md\\:prose-lg>ol>li>p:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-bottom": "1.33333em",
        },
      "& .md\\:prose-lg :where(ul ul,ul ol,ol ul,ol ol):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": ".888889em",
          "margin-bottom": ".888889em",
        },
      "& .md\\:prose-lg :where(dl):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.33333em",
          "margin-bottom": "1.33333em",
        },
      "& .md\\:prose-lg :where(dt):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.33333em",
        },
      "& .md\\:prose-lg :where(dd):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": ".666667em",
          "padding-inline-start": "1.55556em",
        },
      "& .md\\:prose-lg :where(hr):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "3.11111em",
          "margin-bottom": "3.11111em",
        },
      "& .md\\:prose-lg :where(hr+*):not(:where([class~=not-prose],[class~=not-prose] *)), & .md\\:prose-lg :where(h2+*):not(:where([class~=not-prose],[class~=not-prose] *)), & .md\\:prose-lg :where(h3+*):not(:where([class~=not-prose],[class~=not-prose] *)), & .md\\:prose-lg :where(h4+*):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "0",
        },
      "& .md\\:prose-lg :where(table):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "font-size": ".888889em",
          "line-height": "1.5",
        },
      "& .md\\:prose-lg :where(thead th):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-inline-end": ".75em",
          "padding-bottom": ".75em",
          "padding-inline-start": ".75em",
        },
      "& .md\\:prose-lg :where(thead th:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-inline-start": "0",
        },
      "& .md\\:prose-lg :where(thead th:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-inline-end": "0",
        },
      "& .md\\:prose-lg :where(tbody td,tfoot td):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-top": ".75em",
          "padding-inline-end": ".75em",
          "padding-bottom": ".75em",
          "padding-inline-start": ".75em",
        },
      "& .md\\:prose-lg :where(tbody td:first-child,tfoot td:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-inline-start": "0",
        },
      "& .md\\:prose-lg :where(tbody td:last-child,tfoot td:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-inline-end": "0",
        },
      "& .md\\:prose-lg :where(figure):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.77778em",
          "margin-bottom": "1.77778em",
        },
      "& .md\\:prose-lg :where(figure>*):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "0",
          "margin-bottom": "0",
        },
      "& .md\\:prose-lg :where(figcaption):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1em",
          "font-size": ".888889em",
          "line-height": "1.5",
        },
      "& .md\\:prose-lg :where(.md\\:prose-lg>:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "0",
        },
      "& .md\\:prose-lg :where(.md\\:prose-lg>:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-bottom": "0",
        },
    },
  } as Parameters<typeof css>[0]),
  css({
    "@media (width>=64rem)": {
      "& .lg\\:-left-20": {
        left: "calc(var(--spacing) * -20)",
      },
      "& .lg\\:prose-xl": {
        "font-size": "1.25rem",
        "line-height": "1.8",
      },
      "& .lg\\:prose-xl :where(p):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.2em",
          "margin-bottom": "1.2em",
        },
      "& .lg\\:prose-xl :where([class~=lead]):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1em",
          "margin-bottom": "1em",
          "font-size": "1.2em",
          "line-height": "1.5",
        },
      "& .lg\\:prose-xl :where(blockquote):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.6em",
          "margin-bottom": "1.6em",
          "padding-inline-start": "1.06667em",
        },
      "& .lg\\:prose-xl :where(h1):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "0",
          "margin-bottom": ".857143em",
          "font-size": "2.8em",
          "line-height": "1",
        },
      "& .lg\\:prose-xl :where(h2):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.55556em",
          "margin-bottom": ".888889em",
          "font-size": "1.8em",
          "line-height": "1.11111",
        },
      "& .lg\\:prose-xl :where(h3):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.6em",
          "margin-bottom": ".666667em",
          "font-size": "1.5em",
          "line-height": "1.33333",
        },
      "& .lg\\:prose-xl :where(h4):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.8em",
          "margin-bottom": ".6em",
          "line-height": "1.6",
        },
      "& .lg\\:prose-xl :where(img):not(:where([class~=not-prose],[class~=not-prose] *)), & .lg\\:prose-xl :where(picture):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "2em",
          "margin-bottom": "2em",
        },
      "& .lg\\:prose-xl :where(picture>img):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "0",
          "margin-bottom": "0",
        },
      "& .lg\\:prose-xl :where(video):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "2em",
          "margin-bottom": "2em",
        },
      "& .lg\\:prose-xl :where(kbd):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-top": ".25em",
          "padding-inline-end": ".4em",
          "padding-bottom": ".25em",
          "border-radius": ".3125rem",
          "padding-inline-start": ".4em",
          "font-size": ".9em",
        },
      "& .lg\\:prose-xl :where(code):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "font-size": ".9em",
        },
      "& .lg\\:prose-xl :where(h2 code):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "font-size": ".861111em",
        },
      "& .lg\\:prose-xl :where(h3 code):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "font-size": ".9em",
        },
      "& .lg\\:prose-xl :where(pre):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-top": "1.11111em",
          "padding-inline-end": "1.33333em",
          "padding-bottom": "1.11111em",
          "border-radius": ".5rem",
          "margin-top": "2em",
          "margin-bottom": "2em",
          "padding-inline-start": "1.33333em",
          "font-size": ".9em",
          "line-height": "1.77778",
        },
      "& .lg\\:prose-xl :where(ol):not(:where([class~=not-prose],[class~=not-prose] *)), & .lg\\:prose-xl :where(ul):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.2em",
          "margin-bottom": "1.2em",
          "padding-inline-start": "1.6em",
        },
      "& .lg\\:prose-xl :where(li):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": ".6em",
          "margin-bottom": ".6em",
        },
      "& .lg\\:prose-xl :where(ol>li):not(:where([class~=not-prose],[class~=not-prose] *)), & .lg\\:prose-xl :where(ul>li):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-inline-start": ".4em",
        },
      "& .lg\\:prose-xl :where(.lg\\:prose-xl>ul>li p):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": ".8em",
          "margin-bottom": ".8em",
        },
      "& .lg\\:prose-xl :where(.lg\\:prose-xl>ul>li>p:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.2em",
        },
      "& .lg\\:prose-xl :where(.lg\\:prose-xl>ul>li>p:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-bottom": "1.2em",
        },
      "& .lg\\:prose-xl :where(.lg\\:prose-xl>ol>li>p:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.2em",
        },
      "& .lg\\:prose-xl :where(.lg\\:prose-xl>ol>li>p:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-bottom": "1.2em",
        },
      "& .lg\\:prose-xl :where(ul ul,ul ol,ol ul,ol ol):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": ".8em",
          "margin-bottom": ".8em",
        },
      "& .lg\\:prose-xl :where(dl):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.2em",
          "margin-bottom": "1.2em",
        },
      "& .lg\\:prose-xl :where(dt):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1.2em",
        },
      "& .lg\\:prose-xl :where(dd):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": ".6em",
          "padding-inline-start": "1.6em",
        },
      "& .lg\\:prose-xl :where(hr):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "2.8em",
          "margin-bottom": "2.8em",
        },
      "& .lg\\:prose-xl :where(hr+*):not(:where([class~=not-prose],[class~=not-prose] *)), & .lg\\:prose-xl :where(h2+*):not(:where([class~=not-prose],[class~=not-prose] *)), & .lg\\:prose-xl :where(h3+*):not(:where([class~=not-prose],[class~=not-prose] *)), & .lg\\:prose-xl :where(h4+*):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "0",
        },
      "& .lg\\:prose-xl :where(table):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "font-size": ".9em",
          "line-height": "1.55556",
        },
      "& .lg\\:prose-xl :where(thead th):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-inline-end": ".666667em",
          "padding-bottom": ".888889em",
          "padding-inline-start": ".666667em",
        },
      "& .lg\\:prose-xl :where(thead th:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-inline-start": "0",
        },
      "& .lg\\:prose-xl :where(thead th:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-inline-end": "0",
        },
      "& .lg\\:prose-xl :where(tbody td,tfoot td):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-top": ".888889em",
          "padding-inline-end": ".666667em",
          "padding-bottom": ".888889em",
          "padding-inline-start": ".666667em",
        },
      "& .lg\\:prose-xl :where(tbody td:first-child,tfoot td:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-inline-start": "0",
        },
      "& .lg\\:prose-xl :where(tbody td:last-child,tfoot td:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "padding-inline-end": "0",
        },
      "& .lg\\:prose-xl :where(figure):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "2em",
          "margin-bottom": "2em",
        },
      "& .lg\\:prose-xl :where(figure>*):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "0",
          "margin-bottom": "0",
        },
      "& .lg\\:prose-xl :where(figcaption):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "1em",
          "font-size": ".9em",
          "line-height": "1.55556",
        },
      "& .lg\\:prose-xl :where(.lg\\:prose-xl>:first-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-top": "0",
        },
      "& .lg\\:prose-xl :where(.lg\\:prose-xl>:last-child):not(:where([class~=not-prose],[class~=not-prose] *))":
        {
          "margin-bottom": "0",
        },
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-p\\:mt-0 :where(p):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-top": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-p\\:mb-4 :where(p):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-bottom": "calc(var(--spacing) * 4)",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose-li\\:my-0 :where(li):not(:where([class~=not-prose],[class~=not-prose] *))":
      {
        "margin-block": "0",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .prose blockquote p:first-of-type:before, & .prose blockquote p:last-of-type:after":
      {
        content: "none",
      },
  } as Parameters<typeof css>[0]),
  css({
    "& .astro-code .line": {
      "white-space": "pre",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .quake-page": {
      "background-image": "url(/images/quake-bg.png)",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .quake-page div>p": {
      "padding-left": "1rem",
      position: "relative",
    },
  } as Parameters<typeof css>[0]),
  css({
    "& .quake-page div>p:before": {
      content: '"•"',
      position: "absolute",
      top: ".125rem",
      left: "0",
    },
  } as Parameters<typeof css>[0]),
  css({
    "&, & body": {
      width: "100%",
      height: "100%",
      margin: "0",
    },
  } as Parameters<typeof css>[0]),
];
