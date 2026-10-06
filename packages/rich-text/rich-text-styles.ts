import { css } from "remix/component";

export const richTextStyles = css({
  "border-radius": "var(--radius-control)",
  border: "0",
  overflow: "visible",
  "& .rich-toolbar": {
    display: "flex",
    "align-items": "center",
    "flex-wrap": "wrap",
    gap: "2px",
    border: "0",
    padding: "0",
    background: "none",
  },
  "& .rich-toolbar button": {
    padding: "4px 8px",
    border: "0",
    background: "transparent",
    "font-size": "12px",
    "border-radius": "var(--radius-control)",
    "min-height": "28px",
  },
  '& .rich-toolbar button:hover:not(:disabled), & .rich-toolbar button[aria-pressed="true"]':
    {
      background: "var(--accent-soft)",
    },
  '& .rich-toolbar button[aria-pressed="true"]': {
    color: "var(--accent)",
  },
  "& .rich-toolbar .bold": {
    "font-weight": "800",
  },
  "& .rich-toolbar .italic": {
    "font-style": "italic",
  },
  "& .rich-toolbar .underline": {
    "text-decoration": "underline",
  },
  "& .rich-toolbar .strike": {
    "text-decoration": "line-through",
  },
  "& .rich-text": {
    outline: "none",
    "overflow-wrap": "anywhere",
    "white-space": "pre-wrap",
    background: "var(--paper)",
    "min-height": "46px",
    padding: "8px 4px",
    "line-height": "1.6",
  },
  "& .rich-text:focus": {
    "box-shadow": "none",
    outline: "2px solid var(--accent)",
    "outline-offset": "2px",
    "border-radius": "var(--radius-control)",
  },
  "& .rich-text a": {
    color: "var(--accent)",
    "text-decoration": "underline",
  },
  "& .inline-link-form": {
    display: "flex",
    gap: "4px",
    width: "100%",
  },
  "& .tiptap p": {
    margin: "0",
  },
  "& .tiptap p + p": {
    "margin-top": "0.5em",
  },
});
