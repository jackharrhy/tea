import { css } from "remix/component";

export const siteStyles = css({
  "& *": {
    "box-sizing": "border-box",
  },
  "& body": {
    margin: "0",
    color: "#232329",
    "font-family": "ui-sans-serif, system-ui, sans-serif",
    "font-size": "16px",
    "line-height": "1.5",
  },
  "& a": {
    color: "inherit",
    "text-decoration": "none",
  },
  "& a:hover": {
    "text-decoration": "underline",
    color: "#494566",
  },
  "& button": {
    font: "inherit",
  },
  "& img": {
    "max-width": "100%",
    height: "auto",
  },
  "& .site-layout": {
    display: "flex",
    gap: "2rem",
    "max-width": "100ch",
    margin: "auto",
    padding: "2rem",
  },
  "& .site-sidebar": {
    width: "12rem",
    "flex-shrink": "0",
  },
  "& .site-portrait": {
    display: "block",
    width: "10rem",
    height: "10rem",
    "object-fit": "contain",
    margin: "0 auto 1rem",
    "border-bottom": "2px solid black",
  },
  "& .site-menu summary": {
    display: "none",
  },
  "& .site-menu section": {
    "margin-bottom": "1rem",
  },
  "& .site-menu h2": {
    "font-size": "1.125rem",
    "min-height": "2rem",
    "background-size": "contain",
    "background-repeat": "no-repeat",
    filter: "brightness(1.4)",
    margin: "0.5rem 0",
  },
  "& .site-menu ul": {
    "list-style": "none",
    padding: "0",
    margin: "0",
  },
  "& .site-menu li": {
    margin: "0.4rem 0",
  },
  '& .site-menu a[aria-current="page"]': {
    "text-decoration": "underline",
    "text-underline-offset": "4px",
  },
  "& .contact-link": {
    display: "block",
    background: "#494566",
    color: "white",
    "text-align": "center",
    "font-style": "italic",
    "font-weight": "600",
    padding: "0.5rem 1rem",
    margin: "1.5rem 0",
  },
  "& .contact-link:hover": {
    color: "white",
    background: "#393550",
  },
  "& .social-links": {
    display: "flex",
    "flex-direction": "column",
    gap: "0.5rem",
  },
  "& .site-content": {
    flex: "1",
    "min-width": "0",
  },
  "& .prose": {
    display: "flex",
    "flex-direction": "column",
    gap: "1rem",
    "max-width": "65ch",
    "overflow-wrap": "anywhere",
  },
  "& .prose p": {
    margin: "0.25rem 0",
    "line-height": "1.8",
  },
  "& .prose h1": {
    "font-size": "2.25em",
    "line-height": "1.12",
    margin: "0 0 0.6em",
    "font-weight": "800",
  },
  "& .prose h2": {
    "font-size": "1.5em",
    "line-height": "1.35",
    margin: "1em 0 0.25em",
  },
  "& .prose h3": {
    "font-size": "1.25em",
    margin: "0.75em 0 0.25em",
  },
  "& .prose a": {
    "text-decoration": "underline",
    "font-weight": "500",
  },
  "& .prose ul, & .prose ol": {
    "padding-left": "1.5em",
    margin: "0.5em 0",
  },
  "& .prose li": {
    margin: "0.4em 0",
  },
  "& .prose blockquote": {
    "border-left": "3px solid #d4d4d8",
    "padding-left": "1em",
    "font-style": "italic",
  },
  "& .prose hr": {
    width: "100%",
    border: "0",
    "border-top": "1px solid #ddd",
    margin: "1em 0",
  },
  "& .prose iframe": {
    "max-width": "100%",
    border: "0",
  },
  "& :focus-visible": {
    outline: "3px solid #477db4",
    "outline-offset": "4px",
  },
  "@media (min-width: 1024px)": {
    "& .prose": {
      "font-size": "1.25rem",
    },
  },
  "@media (max-width: 1023px)": {
    "& .site-layout": {
      "flex-direction": "column",
      "align-items": "center",
      padding: "1.5rem",
      gap: "1.5rem",
    },
    "& .site-sidebar": {
      width: "100%",
    },
    "& .site-menu summary": {
      display: "block",
      background: "#494566",
      color: "white",
      padding: "0.5rem 1rem",
      cursor: "pointer",
      "font-weight": "700",
    },
    "& .site-menu > div": {
      padding: "1rem",
    },
    "& .site-content": {
      width: "100%",
    },
  },
  "@media (prefers-reduced-motion: reduce)": {
    "& *": {
      transition: "none !important",
    },
  },
});
