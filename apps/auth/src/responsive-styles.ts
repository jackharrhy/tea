import { css } from "remix/component";

export const responsiveStyles = css({
  "@media (min-width: 1440px)": {
    "& .workspace": {
      marginTop: "48px",
    },
  },
  "@media (max-width: 1000px)": {
    "& .site-header": {
      padding: "0 24px",
      gap: "15px",
    },
    "& .desktop-nav > a, & .nav-button": {
      padding: "9px 8px",
    },
    "& .workspace": {
      padding: "0 24px",
    },
    "& .row-action": {
      display: "none",
    },
    "& .settings-row": {
      gap: "30px",
      gridTemplateColumns: "minmax(150px, 0.7fr) minmax(0, 1.3fr)",
    },
  },
  "@media (max-width: 760px)": {
    "& .site-header": {
      minHeight: "68px",
      padding: "0 20px",
    },
    "& .brand": {
      fontSize: "26px",
    },
    "& .desktop-nav": {
      display: "none",
    },
    "& .mobile-nav": {
      display: "block",
    },
    "& .mobile-nav summary": {
      cursor: "pointer",
      minHeight: "44px",
      display: "flex",
      alignItems: "center",
      padding: "6px 10px",
    },
    "& .mobile-nav nav": {
      position: "absolute",
      top: "60px",
      right: "15px",
      left: "15px",
      padding: "12px",
      background: "var(--surface)",
      border: "1px solid var(--line)",
      borderRadius: "8px",
      boxShadow: "0 12px 25px #15233114",
      display: "grid",
      zIndex: "5",
    },
    "& .mobile-nav:not([open]) nav": {
      display: "none",
    },
    "& .mobile-nav nav a": {
      padding: "12px 15px",
      textDecoration: "none",
      color: "var(--ink)",
      borderRadius: "5px",
    },
    '& .mobile-nav nav a[aria-current="page"]': {
      background: "#edf0f2",
    },
    "& .mobile-nav .nav-button": {
      width: "100%",
      justifyContent: "flex-start",
      padding: "12px 15px",
    },
    "& .workspace": {
      margin: "28px auto 50px",
      padding: "0 20px",
    },
    "& .page-heading": {
      gap: "15px",
      alignItems: "flex-start",
    },
    "& h1": {
      fontSize: "25px",
    },
    "& .page-heading > .button": {
      padding: "8px 10px",
      fontSize: "12px",
    },
    "& .filters": {
      flexWrap: "wrap",
      gap: "10px",
    },
    "& .filters label:first-child": {
      flexBasis: "100%",
      maxWidth: "none",
    },
    "& .filters label:nth-child(2)": {
      flex: "1",
    },
    "& .filters button": {
      minHeight: "44px",
    },
    "& .row-meta": {
      display: "none",
    },
    "& .status-label": {
      fontSize: "12px",
    },
    "& .settings-row, & .membership-row": {
      gridTemplateColumns: "1fr",
      gap: "20px",
    },
    "& .form-stack": {
      maxWidth: "none",
    },
    "& .profile > div": {
      gridTemplateColumns: "100px minmax(0, 1fr)",
      gap: "15px",
    },
    "& .auth-page": {
      margin: "25px auto 35px",
      maxWidth: "390px",
      padding: "26px",
    },
    "& .auth-page:has(.login-title)": { margin: "0 auto" },
    "&.authentication .site-header": {
      padding: "0 23px",
      minHeight: "74px",
    },
    "&.authentication .auth-page": {
      width: "calc(100% - 36px)",
    },
    "& button, & .button": {
      minHeight: "44px",
    },
  },
  "@media (max-width: 450px)": {
    "& .role-options": {
      gridTemplateColumns: "1fr",
    },
    "& .notice": {
      padding: "14px 16px",
    },
  },
  "@media (prefers-color-scheme: dark)": {
    "--ui-action-surface": "#e3eaf0",
    "--ui-action-hover": "#c9d6e2",
    "--ui-action-ink": "#17222c",
    "& .brand": {
      color: "#e7ebee",
    },
    "& .brand-dot": {
      color: "#a0bbce",
    },
    "& .desktop-nav > a, & .nav-button": {
      color: "#b3bdc5",
    },
    '& .desktop-nav > a:hover, & .nav-button:hover, & .desktop-nav > a[aria-current="page"], & .mobile-nav nav a[aria-current="page"]':
      {
        background: "#292e32",
        color: "#fff",
      },
    "& .status-label": {
      background: "#303b43",
      color: "#ccdae4",
    },
    "& .notice": {
      background: "#26323b",
      color: "#ccdae4",
    },
    "& .primary": {
      background: "#e3eaf0",
      color: "#17222c",
      borderColor: "#e3eaf0",
    },
    "& .primary:hover": {
      background: "#c9d6e2",
      color: "#17222c",
      borderColor: "#c9d6e2",
    },
    "& button:hover, & .button:hover": {
      background: "#303a42",
    },
    "& .error": {
      background: "#402925",
      color: "#f2c1b9",
      borderColor: "#70453d",
    },
    "& .auth-page": {
      background: "#1c2023f7",
      borderColor: "#3b474f",
    },
    "& .auth-art": {
      opacity: "0.65",
      "--doodle-ink": "#354d5e",
      "--doodle-fill": "#253a48",
      "--doodle-wash": "#1c272f",
    },
  },
  "& .app-section + .app-section": {
    marginTop: "38px",
  },
  "& .app-section-title": {
    fontSize: "17px",
    fontWeight: "600",
    margin: "0 0 16px",
  },
  "& .preview-banner": {
    position: "relative",
    zIndex: "2",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    flexWrap: "wrap",
    padding: "10px 20px",
    background: "var(--ink)",
    color: "var(--surface)",
    fontSize: "13px",
  },
  "& .preview-banner a": {
    color: "inherit",
    textUnderlineOffset: "3px",
  },
  "& .auth-art[hidden]": {
    display: "none",
  },
});
