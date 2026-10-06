import { css } from "remix/component";

export const adminCoreStyles = css({
  "color-scheme": "light",
  "--ink": "oklch(0.3 0.026 60)",
  "--muted": "oklch(0.49 0.025 65)",
  "--line": "oklch(0.91 0.014 80)",
  "--field-border": "oklch(0.62 0.045 60)",
  "--paper": "oklch(0.995 0.003 85)",
  "--canvas": "oklch(0.984 0.007 85)",
  "--surface": "oklch(0.963 0.011 82)",
  "--surface-hover": "oklch(0.925 0.017 82)",
  "--tea": "oklch(0.4 0.066 50)",
  "--on-tea": "oklch(0.982 0.012 85)",
  "--accent": "oklch(0.45 0.081 125)",
  "--accent-hover": "oklch(0.385 0.078 125)",
  "--accent-soft": "oklch(0.955 0.024 125)",
  "--on-accent": "oklch(0.982 0.012 85)",
  "--danger": "oklch(0.44 0.12 30)",
  "--danger-hover": "oklch(0.36 0.11 30)",
  "--danger-soft": "oklch(0.95 0.022 35)",
  "--danger-soft-hover": "oklch(0.91 0.041 35)",
  "--shadow": "oklch(0.25 0.04 50 / 0.15)",
  "--backdrop": "oklch(0.25 0.04 50 / 0.55)",
  "--radius": "6px",
  "--radius-control": "4px",
  "& *": {
    "box-sizing": "border-box",
  },
  "& body": {
    margin: "0px",
    color: "var(--ink)",
    background: "var(--canvas)",
    font: '14px / 1.5 "Inter",\n    ui-sans-serif,\n    system-ui,\n    -apple-system,\n    BlinkMacSystemFont,\n    "Segoe UI",\n    sans-serif',
    "font-optical-sizing": "auto",
  },
  "& button, & input, & textarea, & select": {
    font: "inherit",
  },
  "& button, & a, & input, & textarea, & select": {
    "-webkit-tap-highlight-color": "transparent",
  },
  "& button, & a": {
    "touch-action": "manipulation",
  },
  "& button": {
    cursor: "pointer",
    color: "inherit",
  },
  "& button:disabled": {
    cursor: "default",
    opacity: "0.6",
  },
  "& a": {
    color: "inherit",
    "text-decoration": "none",
  },
  "& a:hover": {
    "text-decoration": "underline",
    "text-underline-offset": "3px",
  },
  "& h1, & h2, & h3, & p": {
    "margin-top": "0px",
  },
  "& h1": {
    "font-weight": "550",
    "line-height": "1.15",
    "margin-bottom": "12px",
    "font-size": "clamp(26px, 2.5vw, 34px)",
    "letter-spacing": "-0.8px",
  },
  "& h2": {
    "font-size": "20px",
    "letter-spacing": "-0.5px",
    "font-weight": "550",
    "line-height": "1.35",
  },
  "& h3": {
    "font-size": "14px",
    "font-weight": "600",
  },
  "& p": {
    "margin-bottom": "16px",
  },
  "& small": {
    "font-size": "12px",
    color: "var(--muted)",
  },
  "& img": {
    "max-width": "100%",
  },
  "& :focus-visible": {
    outline: "3px solid var(--accent)",
    "outline-offset": "3px",
  },
  "& label": {
    display: "flex",
    "flex-direction": "column",
    "font-weight": "550",
    "margin-bottom": "14px",
    gap: "5px",
  },
  "& label small": {
    "font-weight": "400",
    "line-height": "1.5",
  },
  '& input:not([type="checkbox"]):not([type="color"]):not([type="file"]), & textarea, & select':
    {
      border: "1px solid var(--line)",
      "border-radius": "var(--radius-control)",
      background: "var(--paper)",
      color: "var(--ink)",
      padding: "10px 12px",
      width: "100%",
      "min-width": "0px",
      transition: "border-color 0.15s",
      "line-height": "1.5",
    },
  "& input:hover, & textarea:hover, & select:hover": {
    "border-color": "var(--field-border)",
  },
  "& select": {
    appearance: "none",
    "padding-right": "38px",
    "background-image":
      "linear-gradient(45deg, transparent 50%, var(--muted) 50%),\n    linear-gradient(135deg, var(--muted) 50%, transparent 50%)",
    "background-position":
      "calc(100% - 19px) calc(50% + 1px),\n    calc(100% - 14px) calc(50% + 1px)",
    "background-repeat": "no-repeat",
    "background-size": "5px 5px",
  },
  "@media (forced-colors: active)": {
    "& select": {
      appearance: "auto",
      "background-image": "none",
      "padding-right": "12px",
    },
  },
  "& textarea": {
    resize: "vertical",
  },
  '& input[type="checkbox"]': {
    "accent-color": "var(--accent)",
    width: "16px",
    height: "16px",
    margin: "0px",
  },
  "& details > summary": {
    cursor: "pointer",
    "font-weight": "550",
    "list-style": "none",
    padding: "12px 0px",
  },
  "& details > summary::before": {
    content: '"+"',
    display: "inline-block",
    "margin-right": "10px",
    color: "var(--muted)",
  },
  "& details[open] > summary::before": {
    content: '"−"',
  },
  "& details[open] > summary": {
    "margin-bottom": "12px",
  },
  "& hr": {
    width: "100%",
    border: "0",
    "border-top": "1px solid var(--line)",
    margin: "20px 0px",
  },
  "& .muted": {
    color: "var(--muted)",
  },
  "& .eyebrow": {
    color: "var(--muted)",
    "line-height": "1.5",
    "margin-bottom": "15px",
    "font-size": "12px",
    "letter-spacing": "0px",
    "font-weight": "600",
  },
  "& .button": {
    border: "0",
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    gap: "12px",
    color: "var(--ink)",
    "border-radius": "var(--radius-control)",
    "font-weight": "550",
    "font-size": "13px",
    "line-height": "1.5",
    "white-space": "nowrap",
    "text-decoration": "none",
    "min-height": "40px",
    transition: "background 0.15s,\n    color 0.15s",
    background: "var(--surface)",
    padding: "7px 12px",
  },
  '& .button:hover:not(:disabled):not([aria-disabled="true"])': {
    "text-decoration": "none",
    background: "var(--surface-hover)",
  },
  '& .button[aria-disabled="true"]': {
    cursor: "default",
    opacity: "0.6",
  },
  "& .button.primary": {
    color: "var(--on-accent)",
    background: "var(--accent)",
  },
  '& .button.primary:hover:not(:disabled):not([aria-disabled="true"])': {
    background: "var(--accent-hover)",
  },
  "& .button.small": {
    "font-size": "12px",
    "min-height": "32px",
    padding: "5px 9px",
  },
  "& .button.danger": {
    background: "var(--danger-soft)",
    color: "var(--danger)",
  },
  '& .button.danger:hover:not(:disabled):not([aria-disabled="true"])': {
    background: "var(--danger-soft-hover)",
    color: "var(--danger-hover)",
  },
  "& .text-button": {
    border: "0px",
    background: "none",
    color: "var(--accent)",
    padding: "0px",
    font: "inherit",
    "text-decoration": "underline",
    "text-underline-offset": "3px",
    transition: "color 0.15s",
  },
  "& .text-button:hover:not(:disabled)": {
    color: "var(--accent-hover)",
    "text-decoration-thickness": "2px",
  },
  "& .text-button.danger": {
    color: "var(--danger)",
  },
  "& .text-button.danger:hover:not(:disabled)": {
    color: "var(--danger-hover)",
  },
  "& .check-label": {
    display: "flex",
    "flex-direction": "row",
    "align-items": "center",
    gap: "8px",
    margin: "0px",
    "font-size": "12px",
    "font-weight": "400",
  },
  "& .notice": {
    padding: "13px 16px",
    "border-radius": "var(--radius-control)",
    background: "var(--accent-soft)",
    border: "1px solid var(--line)",
    color: "var(--accent)",
    margin: "12px 0px 20px",
  },
  "& .notice.error": {
    background: "var(--danger-soft)",
    "border-color": "var(--line)",
    color: "var(--danger)",
  },
  "& .notice button": {
    "margin-left": "12px",
  },
  "& .panel": {
    border: "1px solid var(--line)",
    background: "var(--paper)",
    "border-radius": "var(--radius)",
    "margin-bottom": "22px",
    padding: "20px",
  },
  "& .section-heading": {
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    gap: "16px",
    "margin-bottom": "20px",
  },
  "& .section-heading h2, & .section-heading .eyebrow": {
    margin: "0px",
  },
  "& .section-heading > a": {
    "font-size": "12px",
    color: "var(--accent)",
  },
  "& .field-grid": {
    display: "grid",
    "grid-template-columns": "1fr 1fr",
    gap: "0px 18px",
  },
  "& .form-actions": {
    display: "flex",
    gap: "12px",
    "margin-top": "20px",
  },
  "& .break-word": {
    "overflow-wrap": "anywhere",
  },
  "& .skip-link": {
    position: "fixed",
    top: "-100px",
    left: "20px",
    "z-index": "100",
    background: "var(--paper)",
    padding: "14px",
  },
  "& .skip-link:focus": {
    top: "12px",
  },
  "& .cms-sidebar": {
    width: "232px",
    position: "fixed",
    inset: "0px auto 0px 0px",
    padding: "30px 20px",
    display: "flex",
    "flex-direction": "column",
    "z-index": "10",
    background: "var(--canvas)",
    "border-right": "0px",
  },
  "& .brand": {
    display: "flex",
    "align-items": "center",
    gap: "9px",
    "font-size": "20px",
    "letter-spacing": "-0.7px",
    "font-weight": "650",
    "text-decoration": "none !important",
  },
  "& .brand-mark": {
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    width: "30px",
    height: "30px",
    "font-size": "24px",
    "line-height": "1",
    "letter-spacing": "0",
  },
  "& .brand small": {
    display: "block",
    "font-size": "12px",
    "letter-spacing": "0px",
    "font-weight": "400",
    "margin-top": "2px",
  },
  "& .cms-sidebar nav": {
    display: "flex",
    "flex-direction": "column",
    gap: "5px",
    "margin-top": "32px",
  },
  "& .cms-sidebar nav > a": {
    padding: "10px 12px",
    "border-radius": "var(--radius-control)",
    display: "flex",
    "align-items": "center",
    gap: "12px",
    color: "var(--ink)",
    "font-weight": "450",
    "white-space": "nowrap",
    "font-size": "14px",
  },
  "& .cms-sidebar nav > a:hover": {
    background: "var(--surface)",
    "text-decoration": "none",
  },
  '& .cms-sidebar nav > a[aria-current="page"]': {
    color: "var(--accent)",
    background: "var(--accent-soft)",
    "font-weight": "600",
    "box-shadow": "none",
  },
  "& .sidebar-footer": {
    "margin-top": "auto",
    padding: "32px 12px 0px",
    display: "flex",
    "flex-direction": "column",
    gap: "18px",
  },
  "& .sidebar-footer > a": {
    display: "flex",
    "justify-content": "space-between",
    "font-size": "12px",
    color: "var(--ink)",
  },
  "& .sidebar-footer .text-button": {
    "font-size": "12px",
    "text-decoration": "none",
    color: "var(--muted)",
  },
  "& .cms-main": {
    "margin-left": "232px",
    "min-height": "100dvh",
    display: "flex",
    "flex-direction": "column",
  },
  "& .workspace-bar": {
    display: "flex",
    "align-items": "center",
    padding: "0px 44px",
    "letter-spacing": "0.1px",
    background: "var(--canvas)",
    height: "56px",
    "min-height": "56px",
    "font-size": "13px",
    border: "0px",
    gap: "16px",
    "justify-content": "flex-start",
  },
  "& .workspace-bar .muted": {
    "margin-left": "10px",
  },
  "& .workspace-status": {
    color: "var(--muted)",
    display: "flex",
    "align-items": "center",
    gap: "7px",
    "font-size": "12px",
  },
  "& .workspace": {
    padding: "44px",
    "max-width": "1400px",
    width: "100%",
    margin: "0px auto",
    flex: "1 1 0%",
  },
  "& .page-heading": {
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    gap: "28px",
    "margin-bottom": "24px",
  },
  "& .page-heading p:last-child": {
    margin: "0px",
  },
  "& .count": {
    display: "inline-block",
    "font-size": "12px",
    background: "var(--surface)",
    color: "var(--muted)",
    padding: "4px 9px",
    "border-radius": "var(--radius-control)",
    "letter-spacing": "0px",
    "vertical-align": "middle",
    "margin-left": "12px",
    "font-weight": "500",
  },
  "& .overview-feature": {
    display: "grid",
    "border-radius": "var(--radius)",
    overflow: "hidden",
    "grid-template-columns": "1fr 210px",
    background: "var(--paper)",
    border: "0px",
    padding: "24px",
    gap: "24px",
    "margin-bottom": "32px",
  },
  "& .overview-feature > div": {
    display: "flex",
    "flex-direction": "column",
    "align-items": "flex-start",
    "justify-content": "center",
  },
  "& .overview-feature h2": {
    "letter-spacing": "-0.8px",
    "max-width": "300px",
    "font-size": "23px",
    margin: "0px 0px 16px",
  },
  "& .overview-feature p": {
    "font-size": "13px",
    color: "var(--muted)",
    "max-width": "320px",
  },
  "& .overview-feature > img": {
    width: "100%",
    "object-fit": "cover",
    "border-radius": "var(--radius-control)",
    height: "190px",
    transform: "none",
  },
  "& .inventory": {
    display: "flex",
    gap: "22px",
    "border-top": "1px solid var(--line)",
    width: "100%",
    color: "var(--muted)",
    "margin-top": "24px",
    "padding-top": "14px",
    "font-size": "12px",
    "flex-wrap": "wrap",
  },
  "& .inventory strong": {
    "font-size": "20px",
    display: "block",
    "line-height": "1.4",
    "font-weight": "500",
    color: "var(--tea)",
  },
  "& .overview-columns": {
    display: "grid",
    "grid-template-columns": "1.1fr 1fr",
    gap: "44px",
  },
  "& .simple-row": {
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    padding: "15px 0px",
    "border-bottom": "1px solid var(--line)",
    "font-size": "13px",
  },
  "& .simple-row small": {
    display: "block",
    "font-size": "12px",
  },
  "& .simple-row > span:last-child": {
    color: "var(--muted)",
  },
  "& .task-row": {
    display: "block",
    padding: "18px 0px",
    "border-bottom": "1px solid var(--line)",
    "font-size": "12px",
  },
  "& .task-row strong": {
    "font-size": "13px",
    "font-weight": "550",
  },
  "& .task-row p": {
    color: "var(--muted)",
    margin: "6px 0px 0px",
  },
  "& .search-bar": {
    display: "flex",
    gap: "12px",
    "margin-bottom": "24px",
    "max-width": "530px",
  },
  "& .page-list": {
    "border-top": "1px solid var(--line)",
  },
  "& .list-heading, & .page-row": {
    display: "grid",
    "grid-template-columns": "minmax(220px, 1fr) 90px 150px 18px",
    gap: "24px",
    "align-items": "center",
  },
  "& .list-heading": {
    "font-size": "12px",
    color: "var(--muted)",
    "letter-spacing": "1px",
    padding: "14px 18px",
  },
  "& .page-row": {
    "border-top": "1px solid var(--line)",
    padding: "15px 18px",
    "font-size": "12px",
    transition: "background 0.15s",
  },
  "& .page-row:hover": {
    background: "var(--paper)",
    "text-decoration": "none",
  },
  "& .page-identity": {
    display: "flex",
    gap: "16px",
    "align-items": "center",
    "min-width": "0px",
  },
  "& .page-identity img, & .page-monogram": {
    width: "48px",
    height: "48px",
    "border-radius": "var(--radius-control)",
    "object-fit": "cover",
    "flex-shrink": "0",
    background: "var(--surface)",
  },
  "& .page-monogram": {
    display: "grid",
    "place-items": "center",
    "font-size": "22px",
    "font-weight": "400",
    color: "var(--muted)",
  },
  "& .page-identity strong": {
    "font-size": "13px",
    "font-weight": "550",
    display: "block",
  },
  "& .page-identity small": {
    "font-size": "12px",
    display: "block",
    color: "var(--muted)",
  },
  "& .badge": {
    display: "inline-flex",
    "align-items": "center",
    width: "max-content",
    "border-radius": "var(--radius-control)",
    padding: "4px 7px",
    background: "var(--surface)",
    color: "var(--muted)",
    "font-size": "12px",
  },
  "& .badge.good": {
    background: "var(--accent-soft)",
    color: "var(--accent)",
  },
  "& .badge.error": {
    background: "var(--danger-soft)",
    color: "var(--danger)",
  },
  "& .row-arrow": {
    color: "var(--muted)",
  },
  "& .new-page": {
    "margin-top": "30px",
  },
  "& .new-page form": {
    "padding-top": "10px",
  },
  "& .empty-state": {
    padding: "50px 20px",
    "text-align": "center",
    color: "var(--muted)",
  },
  "& .wide .workspace": {
    padding: "30px 24px",
    "max-width": "none",
  },
  "& .login-layout": {
    "min-height": "100dvh",
    display: "flex",
    "flex-direction": "column",
    "justify-content": "center",
    width: "min(100%, 420px)",
    margin: "auto",
    padding: "32px 24px",
  },
  "& .login-intro": {
    padding: "0px 0px 24px",
  },
  "& .login-intro > p": {
    margin: "12px 0px 0px",
    color: "var(--muted)",
  },
  "& .login-panel": {
    padding: "0",
    background: "transparent",
  },
  "& .login-panel form": {
    width: "100%",
  },
  "& .login-panel h1": {
    "font-size": "26px",
    "margin-bottom": "24px",
  },
  "& .login-panel .button": {
    width: "100%",
    margin: "4px 0px 20px",
  },
  "& .login-panel form > a": {
    "font-size": "13px",
    color: "var(--muted)",
  },
  "& input::placeholder, & textarea::placeholder": {
    color: "var(--muted)",
    opacity: "1",
  },
  "& .button:active:not(:disabled)": {
    transform: "translateY(1px)",
  },
  "& .workspace-status[hidden], & .workspace-status:not([role])": {
    display: "none",
  },
  "& .workspace, & .wide .workspace": {
    "padding-top": "20px",
  },
  "& dialog": {
    font: "inherit",
    color: "var(--ink)",
    background: "var(--paper)",
    border: "0px",
    "border-radius": "8px",
    "box-shadow": "0 16px 70px var(--shadow)",
  },
  "& dialog::backdrop": {
    background: "var(--backdrop)",
  },
  "& .cms-sidebar[hidden]": {
    display: "none",
  },
  "& .cms-navigation-collapsed .cms-main": {
    "margin-left": "0px",
  },
  "& .workspace-bar > .workspace-status": {
    "margin-left": "auto",
  },
  "@media (max-width: 1200px)": {
    "& .cms-sidebar": {
      width: "200px",
      padding: "25px 14px",
    },
    "& .cms-main": {
      "margin-left": "200px",
    },
    "& .workspace": {
      padding: "30px",
    },
    "& .workspace-bar": {
      padding: "0px 30px",
    },
    "& .overview-feature": {
      gap: "20px",
      padding: "24px",
    },
    "& .overview-feature > img": {
      height: "260px",
    },
    "& .list-heading, & .page-row": {
      gap: "14px",
      "grid-template-columns": "minmax(180px, 1fr) 70px 135px 10px",
    },
  },
  "@media (max-width: 800px)": {
    "& .cms-sidebar": {
      position: "relative",
      width: "100%",
      "border-right": "0px",
      "border-bottom": "1px solid var(--line)",
      padding: "16px 20px",
    },
    "& .brand": {
      "font-size": "19px",
    },
    "& .brand-mark": {
      width: "28px",
      height: "28px",
      "font-size": "23px",
    },
    "& .cms-sidebar nav": {
      "flex-direction": "row",
      "overflow-x": "auto",
      gap: "4px",
      "margin-top": "16px",
    },
    "& .cms-sidebar nav > a": {
      padding: "8px 12px",
      "font-size": "13px",
    },
    "& .cms-main": {
      margin: "0px",
    },
    "& .workspace-bar": {
      height: "48px",
      "min-height": "48px",
      padding: "0px 20px",
    },
    "& .workspace-status": {
      display: "none",
    },
    "& .workspace, & .wide .workspace": {
      padding: "26px 20px",
    },
    "& .page-heading": {
      "align-items": "flex-start",
      "margin-bottom": "28px",
    },
    "& .page-heading p.muted": {
      "font-size": "12px",
    },
    "& .page-heading > .button": {
      "font-size": "12px",
      padding: "8px 11px",
    },
    "& .overview-feature > img": {
      height: "180px",
    },
    "& .overview-feature h2": {
      "font-size": "24px",
    },
    "& .overview-columns": {
      gap: "28px",
    },
    "& .list-heading, & .page-row": {
      "grid-template-columns": "minmax(160px, 1fr) 60px 100px",
      gap: "12px",
      padding: "12px 6px",
    },
    "& .row-arrow": {
      display: "none",
    },
    "& .badge": {
      "font-size": "12px",
    },
    "& .page-identity": {
      gap: "10px",
    },
    "& .page-identity img, & .page-monogram": {
      width: "38px",
      height: "38px",
    },
    "& .page-identity strong": {
      "font-size": "12px",
    },
    "& .overview-feature": {
      "grid-template-columns": "1fr 160px",
    },
    "& .sidebar-footer": {
      display: "flex",
      "flex-direction": "row",
      "margin-top": "12px",
      padding: "8px 0px 0px",
      "justify-content": "space-between",
    },
  },
  "@media (max-width: 540px)": {
    "& h1": {
      "font-size": "28px",
      "letter-spacing": "-1px",
    },
    "& .page-heading": {
      gap: "12px",
      "flex-wrap": "wrap",
    },
    "& .overview-feature": {
      padding: "22px",
      "grid-template-columns": "1fr",
    },
    "& .overview-feature > img": {
      height: "180px",
      "object-position": "center 40%",
    },
    "& .overview-feature h2": {
      "max-width": "none",
    },
    "& .overview-columns": {
      "grid-template-columns": "1fr",
    },
    "& .list-heading, & .page-row": {
      "grid-template-columns": "minmax(0px, 1fr) 105px",
    },
    "& .list-heading > span:nth-child(2), & .page-row > .muted": {
      display: "none",
    },
    "& .page-identity strong": {
      "font-size": "12px",
    },
    "& .field-grid": {
      "grid-template-columns": "1fr",
    },
    "& .panel": {
      padding: "18px",
    },
    "& .inventory": {
      gap: "18px",
    },
    "& .wide .workspace": {
      "padding-left": "16px",
      "padding-right": "16px",
    },
    "& .workspace-bar": {
      padding: "10px 16px",
      gap: "10px",
      height: "auto",
    },
  },
  "@media (prefers-reduced-motion: reduce)": {
    "& *": {
      transition: "none !important",
      "scroll-behavior": "auto !important",
    },
  },
});
