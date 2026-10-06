import { css } from "remix/component";

export const siteStyles = css({
  "color-scheme": "dark",
  "--surface": "#0b080f",
  "--text": "#eee9f0",
  "--muted": "#c9c3ce",
  "--line": "#77717c",
  "--section": "#171123",
  "& *": {
    "box-sizing": "border-box",
  },
  background: "var(--surface)",
  "scroll-padding-top": "2rem",
  "& body": {
    margin: "0",
    color: "var(--text)",
    font: '20px/1.7 "EB Garamond",\n    Garamond,\n    Georgia,\n    serif',
    "-webkit-font-smoothing": "antialiased",
  },
  "& a": {
    color: "inherit",
    "text-underline-offset": "5px",
    "text-decoration-thickness": "1px",
  },
  "& a:hover": {
    color: "#fff",
  },
  "& a:focus-visible, & summary:focus-visible": {
    outline: "2px solid var(--text)",
    "outline-offset": "7px",
  },
  "& img": {
    display: "block",
    "max-width": "100%",
    height: "auto",
  },
  "& button, & input": {
    font: "inherit",
  },
  "& .skip-link": {
    position: "fixed",
    left: "1rem",
    top: "-6rem",
    padding: "0.5rem 1rem",
    background: "var(--surface)",
    "z-index": "3",
  },
  "& .skip-link:focus": {
    top: "1rem",
  },
  "& .site-header": {
    position: "relative",
    "max-width": "1440px",
    margin: "auto",
    padding: "24px 4% 26px",
    "min-height": "170px",
    "text-align": "center",
  },
  "& .site-title": {
    display: "inline-block",
    "font-size": "36px",
    "line-height": "1.2",
    "text-decoration": "none",
    "font-weight": "400",
  },
  "& .header-socials": {
    position: "absolute",
    left: "4%",
    top: "73px",
  },
  "& .social-links": {
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    gap: "20px",
  },
  "& .social-links a": {
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    "min-width": "32px",
    "min-height": "36px",
  },
  "& .social-links img": {
    width: "24px",
    height: "24px",
    "object-fit": "contain",
  },
  "& .site-menu": {
    "margin-top": "35px",
  },
  "& .site-menu summary": {
    display: "none",
  },
  "& .site-menu nav": {
    display: "flex",
    "justify-content": "center",
    gap: "25px",
    "font-size": "20px",
    "line-height": "1.4",
  },
  "& .site-menu a": {
    "text-decoration": "none",
    "padding-bottom": "6px",
    "border-bottom": "1px solid transparent",
  },
  '& .site-menu a[aria-current="page"], & .site-menu a:hover': {
    "border-color": "currentColor",
  },
  "@media (min-width: 768px)": {
    "& .site-menu:not([open]) > nav": {
      display: "flex !important",
    },
  },
  "& .site-content": {
    padding: "72px 4% 36px",
    margin: "0 auto",
    "max-width": "1440px",
    "min-height": "40dvh",
  },
  "& .prose h1, & .prose h2, & .prose h3": {
    "font-weight": "400",
    "line-height": "1.2",
    margin: "0 0 32px",
  },
  "& .prose h1": {
    "font-size": "56px",
  },
  "& .prose h2": {
    "font-size": "32px",
  },
  "& .prose h3": {
    "font-size": "27px",
  },
  "& .prose p": {
    margin: "0 0 22px",
  },
  "& .prose hr": {
    border: "0",
    "border-top": "1px solid var(--line)",
    margin: "45px 0",
  },
  "& .prose > img": {
    margin: "0 auto 32px",
  },
  "& .prose strong": {
    "font-weight": "650",
  },
  "& .prose em": {
    "line-height": "1.4",
  },
  "& .site-footer": {
    "text-align": "center",
    padding: "110px 24px 105px",
    "font-size": "17px",
  },
  "& .site-footer .social-links": {
    gap: "9px",
    "margin-bottom": "10px",
  },
  "& .site-footer img": {
    width: "22px",
    height: "22px",
  },
  "& .footer-email": {
    "overflow-wrap": "anywhere",
  },
  "& .home-stage": {
    "background-position": "center",
    "background-size": "cover",
    "background-repeat": "no-repeat",
  },
  "& .home-stage .site-header": {
    background: "rgb(11 8 15 / 0.78)",
    "backdrop-filter": "blur(9px)",
    "max-width": "none",
  },
  "& .page-home": {
    padding: "56px 24px 48px",
    "min-height": "0",
  },
  "& .page-home .prose > img": {
    width: "min(47vw, 580px)",
    "aspect-ratio": "655/740",
    "object-fit": "cover",
    "object-position": "center 44%",
    margin: "0 auto",
  },
  "& .page-about": {
    "max-width": "1080px",
  },
  "& .page-about h2, & .page-about h3": {
    "text-align": "center",
  },
  "& .page-about h3:not(:first-child)": {
    "margin-top": "110px",
  },
  "& .download-links": {
    display: "flex",
    "align-items": "center",
    "justify-content": "space-around",
    gap: "24px",
    "flex-wrap": "wrap",
  },
  "& .outline-link": {
    display: "inline-block",
    border: "1px solid var(--text)",
    padding: "15px 28px",
    "text-decoration": "none",
    "font-size": "17px",
    "white-space": "nowrap",
    "line-height": "1.4",
  },
  "& .outline-link:hover": {
    background: "var(--text)",
    color: "var(--surface)",
  },
  "& .outline-link:active": {
    transform: "scale(0.98)",
  },
  "& .page-works .prose": {
    "font-size": "18px",
  },
  "& .page-works h2": {
    "font-size": "29px",
    "margin-bottom": "32px",
  },
  "& .page-works p:has(> em:only-child)": {
    "margin-left": "40px",
  },
  "& .works-links": {
    display: "flex",
    "justify-content": "space-around",
    gap: "24px",
    "flex-wrap": "wrap",
  },
  "& .works-end": {
    "text-align": "center",
  },
  "& .page-contact": {
    "padding-top": "65px",
    "max-width": "1380px",
  },
  "& .page-contact .prose": {
    display: "grid",
    "grid-template-columns": "1fr 1fr",
    "column-gap": "8%",
    "align-content": "center",
    "align-items": "center",
  },
  "& .page-contact .prose > img": {
    "grid-column": "2",
    "grid-row": "1",
    width: "100%",
    "max-height": "780px",
    "object-fit": "cover",
    margin: "0",
  },
  "& .page-contact .contact-copy h1": {
    "grid-column": "1",
    "align-self": "end",
    margin: "0 0 42px",
    "font-size": "64px",
  },
  "& .page-contact .contact-copy p": {
    "grid-column": "1",
    "align-self": "start",
  },
  "& .page-contact .contact-copy p:last-child": {
    "overflow-wrap": "anywhere",
  },
  "& .page-media": {
    "max-width": "none",
  },
  "& .page-media .prose > :not(.listen-section)": {
    "max-width": "1000px",
    "margin-left": "auto",
    "margin-right": "auto",
  },
  "& .page-media .prose > h2": {
    "text-align": "center",
    "font-size": "44px",
  },
  "& .recording": {
    margin: "0 0 80px",
    display: "flex",
    "flex-direction": "column",
  },
  "& .recording iframe": {
    border: "0",
    width: "100%",
    background: "#151019",
    display: "block",
    order: "-1",
  },
  "& .recording-video iframe": {
    "aspect-ratio": "16/9",
    height: "auto",
  },
  "& .recording-caption": {
    "text-align": "right",
    "margin-top": "24px",
  },
  "& .recording-caption h3": {
    "font-size": "27px",
    margin: "0 0 12px",
  },
  "& .recording-caption p": {
    "font-size": "18px",
    color: "var(--muted)",
    margin: "0",
  },
  "& .listen-section": {
    display: "grid",
    "grid-template-columns": "minmax(0, 0.85fr) minmax(0, 1fr)",
    gap: "8%",
    background: "var(--section)",
    padding: "56px 4vw",
    margin: "90px -4vw -36px",
  },
  "& .listen-section h2": {
    "font-size": "44px",
  },
  "& .listen-section > p": {
    "font-size": "18px",
  },
  "& .listen-section .recording:last-child": {
    "margin-bottom": "0",
  },
  "& .page-recordings": {
    "min-height": "50dvh",
  },
  "& .page-missing": {
    "text-align": "center",
  },
  "@media (max-width: 767px)": {
    "& body": {
      "font-size": "18px",
      "line-height": "1.65",
    },
    "& .site-header": {
      padding: "24px 22px",
      "min-height": "114px",
      "text-align": "left",
      display: "flex",
      "align-items": "flex-start",
      "justify-content": "space-between",
      gap: "14px",
    },
    "& .site-title": {
      "font-size": "27px",
      "max-width": "275px",
      "line-height": "1.15",
    },
    "& .header-socials": {
      display: "none",
    },
    "& .site-menu": {
      margin: "0",
    },
    "& .site-menu summary": {
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      cursor: "pointer",
      "min-width": "44px",
      "min-height": "44px",
      "list-style": "none",
    },
    "& .site-menu summary::-webkit-details-marker": {
      display: "none",
    },
    "& .menu-label": {
      position: "absolute",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      "clip-path": "inset(50%)",
    },
    "& .menu-bars, & .menu-bars:before, & .menu-bars:after": {
      display: "block",
      width: "26px",
      height: "1px",
      background: "var(--text)",
    },
    "& .menu-bars:before, & .menu-bars:after": {
      content: '""',
      position: "relative",
    },
    "& .menu-bars:before": {
      top: "-7px",
    },
    "& .menu-bars:after": {
      top: "6px",
    },
    "& .site-menu[open] nav": {
      position: "absolute",
      top: "100%",
      left: "0",
      right: "0",
      background: "#17121d",
      "z-index": "2",
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      gap: "14px",
      padding: "28px 24px 36px",
      "font-size": "27px",
      "border-bottom": "1px solid var(--line)",
    },
    "& .site-menu[open] .menu-bars": {
      background: "transparent",
    },
    "& .site-menu[open] .menu-bars:before": {
      top: "0",
      transform: "rotate(45deg)",
    },
    "& .site-menu[open] .menu-bars:after": {
      top: "-1px",
      transform: "rotate(-45deg)",
    },
    "& .site-content": {
      padding: "42px 24px 24px",
    },
    "& .prose h1": {
      "font-size": "44px",
    },
    "& .prose h2": {
      "font-size": "28px",
    },
    "& .prose h3": {
      "font-size": "25px",
    },
    "& .prose hr": {
      margin: "32px 0",
    },
    "& .site-footer": {
      padding: "70px 20px",
      "font-size": "16px",
    },
    "& .page-home": {
      padding: "32px 24px 40px",
    },
    "& .page-home .prose > img": {
      width: "min(82vw, 480px)",
      "max-height": "600px",
    },
    "& .home-stage .site-header": {
      "backdrop-filter": "none",
    },
    "& .page-about h3:not(:first-child)": {
      "margin-top": "65px",
    },
    "& .download-links": {
      display: "grid",
      "grid-template-columns": "1fr",
      gap: "16px",
      "text-align": "center",
    },
    "& .outline-link": {
      "font-size": "16px",
      padding: "14px 18px",
      "white-space": "normal",
    },
    "& .works-links": {
      display: "grid",
      "grid-template-columns": "1fr",
      "text-align": "center",
      gap: "16px",
    },
    "& .page-works .prose": {
      "font-size": "17px",
    },
    "& .page-works h2": {
      "font-size": "27px",
    },
    "& .page-works p:has(> em:only-child)": {
      "margin-left": "20px",
    },
    "& .page-contact .prose": {
      display: "flex",
      "flex-direction": "column",
      "align-items": "stretch",
    },
    "& .page-contact .prose > img": {
      order: "-1",
      width: "100%",
      "max-height": "540px",
      "object-fit": "cover",
      "margin-bottom": "40px",
    },
    "& .page-contact .contact-copy h1": {
      "font-size": "48px",
      "align-self": "auto",
      "margin-bottom": "24px",
    },
    "& .page-media .prose > h2, & .listen-section h2": {
      "font-size": "36px",
    },
    "& .recording": {
      "margin-bottom": "52px",
    },
    "& .recording-caption": {
      "margin-top": "18px",
    },
    "& .recording-caption h3": {
      "font-size": "24px",
    },
    "& .recording-caption p": {
      "font-size": "17px",
    },
    "& .listen-section": {
      "grid-template-columns": "1fr",
      gap: "28px",
      margin: "60px -24px -24px",
      padding: "36px 24px",
    },
    "& .recording-audio iframe": {
      height: "260px",
    },
  },
  "@media (prefers-reduced-transparency: reduce)": {
    "& .home-stage .site-header": {
      background: "var(--surface)",
      "backdrop-filter": "none",
    },
  },
});
