import { css } from "remix/component";

export const adminLibraryStyles = css({
  "& .media-dialog": {
    width: "min(900px, 92vw)",
    "max-height": "85dvh",
    border: "1px solid var(--line)",
    "border-radius": "var(--radius)",
    padding: "26px",
    color: "var(--ink)",
    "box-shadow": "0 20px 80px var(--shadow)",
    background: "var(--paper)",
  },
  "& .media-dialog::backdrop": {
    background: "var(--backdrop)",
    "backdrop-filter": "none",
  },
  "& .media-dialog .picker-grid": {
    "margin-top": "20px",
    "max-height": "52dvh",
    overflow: "auto",
  },
  "& .picker-grid": {
    display: "grid",
    "grid-template-columns": "repeat(4, minmax(0px, 1fr))",
    gap: "12px",
  },
  "& .picker-image": {
    display: "flex",
    "flex-direction": "column",
    "text-align": "left",
    border: "1px solid var(--line)",
    "border-radius": "var(--radius-control)",
    padding: "8px",
    background: "var(--paper)",
    "min-width": "0px",
  },
  "& .picker-image img": {
    height: "130px",
    width: "100%",
    "object-fit": "contain",
  },
  "& .picker-image span": {
    "font-size": "12px",
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
    width: "100%",
    "margin-top": "8px",
  },
  "& .picker-image:hover": {
    "border-color": "var(--accent)",
  },
  "& .media-dialog > p": {
    "font-size": "12px",
    margin: "18px 0px 0px",
  },
  "& .upload-button": {
    position: "relative",
    margin: "0px",
    overflow: "hidden",
  },
  "& .upload-button input": {
    position: "absolute",
    inset: "0px",
    opacity: "0",
    cursor: "pointer",
  },
  "& .media-tools": {
    display: "flex",
    gap: "16px",
    "margin-bottom": "26px",
  },
  "& .media-tools input": {
    "max-width": "460px",
  },
  "& .media-tools select": {
    "max-width": "210px",
  },
  "& .media-workspace": {
    display: "grid",
    "grid-template-columns": "minmax(0px, 1fr) 280px",
    gap: "28px",
    "align-items": "start",
  },
  "& .media-grid": {
    display: "grid",
    "grid-template-columns": "repeat(3, minmax(0px, 1fr))",
    gap: "16px",
    "min-height": "300px",
  },
  "& .media-tile": {
    "text-align": "left",
    padding: "0px",
    background: "var(--paper)",
    border: "1px solid var(--line)",
    "border-radius": "var(--radius)",
    overflow: "hidden",
    "min-width": "0px",
    transition: "box-shadow 0.15s",
  },
  "& .media-tile:hover:not(:disabled)": {
    "box-shadow": "inset 0 0 0 1px var(--accent)",
  },
  "& .media-tile.selected": {
    "border-color": "var(--accent)",
    "box-shadow": "0 0 0 1px var(--accent)",
  },
  "& .media-tile > img, & .file-preview": {
    height: "180px",
    "object-fit": "contain",
    width: "100%",
    background:
      "repeating-conic-gradient(\n      var(--surface) 0% 25%,\n      var(--paper) 0% 50%\n    )\n    50%/16px 16px",
    padding: "12px",
  },
  "& .media-tile > span": {
    display: "block",
    padding: "12px",
  },
  "& .media-tile strong": {
    display: "block",
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
    "font-size": "12px",
    "font-weight": "500",
  },
  "& .media-tile small": {
    display: "block",
    "font-size": "12px",
    "margin-top": "4px",
  },
  "& .file-preview": {
    display: "grid",
    "place-items": "center",
    color: "var(--muted)",
    "font-size": "25px",
    "letter-spacing": "1px",
  },
  "& .media-inspector": {
    position: "sticky",
    top: "24px",
    display: "flex",
    "flex-direction": "column",
    gap: "16px",
    border: "1px solid var(--line)",
    "border-radius": "var(--radius)",
    "font-size": "12px",
    padding: "16px",
    background: "var(--paper)",
  },
  "& .media-inspector .section-heading, & .media-inspector label, & .media-inspector p":
    {
      margin: "0px",
    },
  "& .media-inspector h2": {
    "font-size": "17px",
  },
  "& .media-inspector h3": {
    margin: "10px 0px -8px",
  },
  "& .media-inspector > a": {
    "font-size": "12px",
    color: "var(--accent)",
  },
  "& .inspector-image": {
    "max-height": "220px",
    "object-fit": "contain",
    background: "var(--surface)",
    "border-radius": "var(--radius-control)",
  },
  "& .inspector-empty": {
    padding: "16px 0px",
  },
  "& .inspector-empty h2": {
    "font-size": "22px",
    margin: "20px 0px 12px",
  },
  "& .inspector-empty p": {
    "margin-bottom": "16px",
  },
  "& .settings-columns": {
    display: "grid",
    "grid-template-columns": "minmax(0px, 1fr) 260px",
    gap: "36px",
    "align-items": "start",
  },
  "& .help-panel": {
    "border-left": "1px solid var(--line)",
    "padding-left": "28px",
    "margin-top": "16px",
    "font-size": "12px",
    color: "var(--muted)",
    position: "sticky",
    top: "30px",
  },
  "& .help-panel h2": {
    color: "var(--ink)",
    "max-width": "200px",
    "font-size": "18px",
  },
  "& .help-panel a": {
    color: "var(--accent)",
    "font-size": "12px",
  },
  "& .navigation-portrait": {
    width: "120px",
    height: "120px",
    "object-fit": "contain",
  },
  "& .navigation-item": {
    display: "grid",
    "grid-template-columns": "1fr 1fr auto",
    gap: "10px",
    "align-items": "center",
    "margin-bottom": "10px",
  },
  "& .navigation-item label": {
    "font-size": "12px",
    margin: "0px",
  },
  "& .navigation-item input, & .navigation-item select": {
    "font-size": "12px",
  },
  "& .category-art": {
    display: "flex",
    gap: "12px",
    "align-items": "center",
    margin: "0px 0px 20px",
  },
  "& .category-art img": {
    width: "70px",
    height: "32px",
    "object-fit": "contain",
  },
  "& .category-art button": {
    "font-size": "12px",
  },
  "& .settings-columns > section > .button": {
    "margin-bottom": "24px",
  },
  "& .adornment-grid": {
    display: "grid",
    "grid-template-columns": "repeat(4, minmax(0px, 1fr))",
    gap: "18px",
  },
  "& .adornment-tile": {
    border: "1px solid var(--line)",
    "border-radius": "var(--radius)",
    background: "var(--paper)",
    overflow: "hidden",
    padding: "0px",
    "text-align": "left",
  },
  "& .adornment-tile > div": {
    height: "150px",
    background: "var(--surface)",
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    padding: "28px",
  },
  "& .adornment-tile img": {
    "max-height": "100px",
    "object-fit": "contain",
  },
  "& .adornment-tile strong": {
    "font-weight": "550",
    "font-size": "12px",
    display: "block",
    padding: "14px 16px",
  },
  "& .adornment-tile:hover:not(:disabled)": {
    "box-shadow": "inset 0 0 0 1px var(--accent)",
  },
  "& .color-field": {
    display: "flex",
    gap: "12px",
  },
  '& .color-field input[type="color"]': {
    height: "44px",
    width: "60px",
    border: "1px solid var(--line)",
    background: "var(--paper)",
    padding: "4px",
    "border-radius": "var(--radius-control)",
  },
  "& .color-preview": {
    height: "150px",
    border: "1px solid var(--line)",
    "border-radius": "var(--radius-control)",
    display: "grid",
    "place-items": "center",
    "margin-bottom": "32px",
    color: "var(--ink)",
  },
  "& .seo-list": {
    display: "grid",
    gap: "12px",
  },
  "& .seo-row": {
    padding: "20px",
    background: "var(--surface)",
    "border-radius": "8px",
    "min-width": "0",
  },
  "& .seo-row-heading": {
    display: "flex",
    "align-items": "center",
    "flex-wrap": "wrap",
    gap: "10px",
    "margin-bottom": "16px",
  },
  "& .seo-row-heading h2": {
    "font-size": "15px",
    margin: "0",
  },
  "& .seo-row-heading a": {
    "margin-left": "auto",
    "font-size": "12px",
  },
  "& .seo-preview": {
    display: "grid",
    "grid-template-columns": "minmax(0, 1fr)",
    gap: "20px",
  },
  "& .seo-preview:has(.seo-thumbnail)": {
    "grid-template-columns": "minmax(0, 1fr) 112px",
  },
  "& .seo-preview h3": {
    "font-size": "19px",
    color: "var(--accent)",
    margin: "6px 0",
    "overflow-wrap": "anywhere",
  },
  "& .seo-preview p": {
    "font-size": "12px",
    color: "var(--muted)",
    "max-width": "560px",
    margin: "0",
    "overflow-wrap": "anywhere",
  },
  "& .search-url": {
    "font-size": "12px",
    color: "var(--muted)",
    "overflow-wrap": "anywhere",
  },
  "& .seo-thumbnail": {
    width: "112px",
    height: "84px",
    "object-fit": "contain",
    "border-radius": "4px",
    background: "var(--paper)",
  },
  "& .seo-checks": {
    display: "flex",
    "flex-wrap": "wrap",
    gap: "6px 18px",
    padding: "0",
    margin: "12px 0 0",
    "list-style": "none",
    "font-size": "12px",
  },
  "& .seo-preview .seo-note": {
    "margin-top": "8px",
  },
  "& .seo-defaults": {
    display: "flex",
    "justify-content": "space-between",
    "align-items": "start",
    gap: "20px",
    "margin-bottom": "24px",
    "font-size": "13px",
  },
  "& .seo-defaults p": {
    margin: "6px 0",
    "overflow-wrap": "anywhere",
  },
  "& .seo-defaults small": {
    color: "var(--muted)",
  },
  "& .seo-defaults a": {
    "flex-shrink": "0",
  },
  "& .seo-filters": {
    display: "flex",
    "flex-wrap": "wrap",
    gap: "8px",
  },
  "& .seo-filters a": {
    padding: "8px 10px",
    "border-radius": "4px",
    "font-size": "12px",
  },
  '& .seo-filters a[aria-current="page"]': {
    background: "var(--accent-soft)",
    color: "var(--accent)",
  },
  "& .seo-filters span": {
    "margin-left": "5px",
    "font-variant-numeric": "tabular-nums",
  },
  "& .seo-help": {
    "font-size": "12px",
    margin: "14px 0",
  },
  "& .seo-draft": {
    "margin-top": "16px",
  },
  "& .seo-draft summary": {
    "font-size": "12px",
    cursor: "pointer",
  },
  "& .seo-footer": {
    display: "flex",
    "flex-wrap": "wrap",
    gap: "16px",
    "margin-top": "24px",
    "font-size": "12px",
    color: "var(--muted)",
  },
  "& .upload-button:focus-within": {
    outline: "3px solid var(--accent)",
    "outline-offset": "3px",
  },
  "& .color-preview > span": {
    background: "var(--paper)",
    color: "var(--ink)",
    padding: "4px 8px",
    "border-radius": "var(--radius-control)",
  },
  "& .adornment-suite": {
    width: "min(1100px, -32px + 100vw)",
    "max-height": "calc(100dvh - 32px)",
    padding: "24px",
  },
  "& .suite-layout": {
    display: "grid",
    "grid-template-columns": "minmax(0px, 1.8fr) minmax(220px, 1fr)",
    gap: "24px",
    "align-items": "start",
  },
  "& .suite-layout .field-grid": {
    "grid-template-columns": "1fr",
  },
  "& .adornment-suite > .form-actions": {
    position: "sticky",
    bottom: "-24px",
    background: "var(--paper)",
    padding: "12px 0px",
    "margin-bottom": "0px",
  },
  "& .advanced-placement": {
    margin: "16px 0px",
  },
  "& .advanced-placement .field-grid": {
    "grid-template-columns": "1fr 1fr",
  },
  "& .media-workspace.with-folders": {
    "grid-template-columns": "175px minmax(0px, 1fr) 260px",
    gap: "20px",
  },
  "& .media-content": {
    "min-width": "0px",
  },
  "& .media-content .media-grid": {
    "grid-template-columns": "repeat(3, minmax(0px, 1fr))",
  },
  "& .folder-nav": {
    "min-width": "0px",
  },
  "& .folder-nav h2": {
    "font-size": "14px",
    "margin-bottom": "10px",
  },
  "& .folder-nav h3": {
    margin: "16px 0px 8px",
  },
  "& .folder-nav .section-heading": {
    gap: "4px",
    "flex-wrap": "wrap",
    "margin-bottom": "4px",
  },
  "& .folder-nav .text-button": {
    "font-size": "12px",
  },
  "& .folder-link": {
    display: "block",
    "text-align": "left",
    width: "100%",
    border: "0px",
    background: "none",
    color: "var(--muted)",
    "border-radius": "4px",
    padding: "7px 10px",
    "overflow-wrap": "anywhere",
  },
  "& .folder-link:hover, & .folder-link.active": {
    color: "var(--accent)",
    background: "var(--accent-soft)",
  },
  "& .folder-link.active": {
    "font-weight": "600",
  },
  "& .folder-heading h2": {
    "font-size": "16px",
  },
  "& .folder-heading p:empty": {
    display: "none",
  },
  "& .folder-children": {
    display: "flex",
    "flex-wrap": "wrap",
    gap: "6px",
    "margin-bottom": "12px",
  },
  "& .folder-dialog": {
    width: "min(440px, -24px + 100vw)",
    padding: "24px",
  },
  "& .navigation-toggle": {
    "flex-shrink": "0",
  },
  "@media (min-width: 1600px)": {
    "& .media-grid": {
      "grid-template-columns": "repeat(4, minmax(0px, 1fr))",
    },
  },
  "@media (max-width: 1200px)": {
    "& .media-grid": {
      "grid-template-columns": "repeat(2, minmax(0px, 1fr))",
    },
    "& .settings-columns": {
      "grid-template-columns": "minmax(0px, 1fr)",
    },
    "& .help-panel": {
      position: "static",
      "max-width": "500px",
    },
    "& .adornment-grid": {
      "grid-template-columns": "repeat(3, minmax(0px, 1fr))",
    },
    "& .media-workspace.with-folders": {
      "grid-template-columns": "150px minmax(0px, 1fr)",
    },
    "& .media-inspector": {
      "grid-column": "2",
    },
    "& .media-content .media-grid": {
      "grid-template-columns": "repeat(3, minmax(0px, 1fr))",
    },
  },
  "@media (max-width: 800px)": {
    "& .media-workspace": {
      "grid-template-columns": "minmax(0px, 1fr)",
    },
    "& .media-grid": {
      "grid-template-columns": "repeat(3, minmax(0px, 1fr))",
    },
    "& .media-inspector": {
      position: "relative",
      top: "0px",
      "grid-column": "auto",
    },
    "& .picker-grid": {
      "grid-template-columns": "repeat(3, minmax(0px, 1fr))",
    },
    "& .suite-layout": {
      "grid-template-columns": "1fr",
    },
    "& .adornment-suite": {
      padding: "16px",
    },
    "& .media-workspace.with-folders": {
      "grid-template-columns": "1fr",
    },
    "& .folder-nav": {
      display: "flex",
      "flex-wrap": "wrap",
      "align-items": "center",
      gap: "4px",
    },
    "& .folder-nav > h2": {
      display: "none",
    },
    "& .folder-nav > .folder-link": {
      width: "auto",
    },
    "& .folder-nav > div": {
      width: "100%",
    },
    "& .folder-nav > .section-heading": {
      width: "auto",
    },
    "& .folder-nav h3": {
      margin: "0px",
    },
  },
  "@media (max-width: 540px)": {
    "& .media-tools": {
      "flex-direction": "column",
      gap: "10px",
    },
    "& .media-tools select": {
      "max-width": "100%",
    },
    "& .media-grid": {
      "grid-template-columns": "repeat(2, minmax(0px, 1fr))",
      gap: "12px",
    },
    "& .media-tile > img, & .file-preview": {
      height: "150px",
    },
    "& .adornment-grid": {
      "grid-template-columns": "repeat(2, minmax(0px, 1fr))",
      gap: "12px",
    },
    "& .adornment-tile > div": {
      height: "120px",
    },
    "& .navigation-item": {
      "grid-template-columns": "1fr 1fr",
    },
    "& .seo-preview:has(.seo-thumbnail)": {
      "grid-template-columns": "1fr",
      gap: "12px",
    },
    "& .seo-defaults": {
      "flex-direction": "column",
      gap: "10px",
    },
    "& .seo-row-heading a": {
      "flex-basis": "100%",
      "margin-left": "0",
    },
    "& .picker-grid": {
      "grid-template-columns": "repeat(2, minmax(0px, 1fr))",
    },
    "& .media-dialog": {
      padding: "18px",
    },
    "& .picker-image img": {
      height: "110px",
    },
    "& .media-content .media-grid": {
      "grid-template-columns": "repeat(2, minmax(0px, 1fr))",
    },
  },
});
