import { css, type Handle, type RemixNode } from "remix/component";

import { routes } from "../routes.ts";
import { desktopIconStyle, desktopStyle } from "./desktop/styles.ts";

type RadioStatusTone = "offline" | "online" | "syncing";

export function RadioHeader(
  handle: Handle<{
    roomName?: string;
    status?: RemixNode;
  }>,
) {
  return () => {
    let roomName = handle.props.roomName;

    return (
      <header mix={[desktopStyle.titleBar, radioHeaderStyle.header]}>
        <nav aria-label="Breadcrumb" mix={radioHeaderStyle.breadcrumbs}>
          {roomName ? (
            <a href={routes.home.href()} mix={radioHeaderStyle.roomsLink}>
              <span aria-hidden="true" mix={radioHeaderStyle.backIcon}>
                arrow_back
              </span>
              <span>rooms</span>
            </a>
          ) : (
            <span aria-current="page" mix={radioHeaderStyle.rootCrumb}>
              rooms
            </span>
          )}
          {roomName ? (
            <>
              <span aria-hidden="true" mix={radioHeaderStyle.separator}>
                /
              </span>
              <span aria-current="page" mix={radioHeaderStyle.currentCrumb}>
                {roomName}
              </span>
            </>
          ) : null}
        </nav>
        {handle.props.status ?? (
          <RadioStatus label="online" tone="online">
            online
          </RadioStatus>
        )}
      </header>
    );
  };
}

export function RadioStatus(
  handle: Handle<{
    label: string;
    tone: RadioStatusTone;
    children?: RemixNode;
  }>,
) {
  return () => (
    <output
      aria-label={handle.props.label}
      data-tone={handle.props.tone}
      mix={radioHeaderStyle.status}
    >
      <span aria-hidden="true">{handle.props.children}</span>
    </output>
  );
}

const radioHeaderStyle = {
  header: css({
    justifyContent: "space-between",
    gap: "12px",
  }),
  breadcrumbs: css({
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "13px",
    fontWeight: 400,
    lineHeight: "20px",
    whiteSpace: "nowrap",
  }),
  roomsLink: css({
    minWidth: 0,
    height: "22px",
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    color: "rgba(255, 255, 255, 0.76)",
    borderRadius: "2px",
    textDecoration: "none",
    textShadow: "0 1px #000",
    "&:hover": {
      color: "#fff",
      background: "rgba(255, 255, 255, 0.12)",
    },
    "&:focus-visible": {
      color: "#fff",
      outline: "1px solid rgba(255, 255, 255, 0.8)",
      outlineOffset: "1px",
    },
  }),
  backIcon: css({
    ...desktopIconStyle,
    width: "14px",
    height: "20px",
    flex: "0 0 14px",
    display: "inline-grid",
    placeItems: "center",
    fontSize: "13px",
    lineHeight: 1,
  }),
  rootCrumb: css({ color: "rgba(255, 255, 255, 0.9)" }),
  separator: css({
    color: "rgba(255, 255, 255, 0.32)",
  }),
  currentCrumb: css({
    overflow: "hidden",
    color: "#fff",
    textOverflow: "ellipsis",
  }),
  status: css({
    width: "12px",
    flex: "0 0 12px",
    height: "100%",
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    position: "relative",
    color: "#fff",
    font: "inherit",
    fontSize: "12px",
    textShadow: "0 1px #000",
    "&::before": {
      content: '""',
      boxSizing: "border-box",
      flex: "0 0 12px",
      width: "12px",
      height: "12px",
      border: "1px solid rgba(31, 42, 49, 0.72)",
      borderRadius: "50%",
      boxShadow:
        "0 1px rgba(255, 255, 255, 0.5) inset, 0 1px 2px rgba(0, 0, 0, 0.35)",
    },
    '&[data-tone="offline"]::before': {
      background:
        "radial-gradient(circle at 35% 30%, #ffd2cc, #d9574f 55%, #8f2722)",
    },
    '&[data-tone="syncing"]::before': {
      background:
        "radial-gradient(circle at 35% 30%, #fff2bd, #d9ad35 55%, #8f6818)",
    },
    '&[data-tone="online"]::before': {
      background:
        "radial-gradient(circle at 35% 30%, #d5f6dc, #43a85b 55%, #236b34)",
    },
    "& > span": {
      position: "absolute",
      top: "50%",
      right: "20px",
      opacity: 0,
      transform: "translate(4px, -50%)",
      transition: "opacity 120ms ease, transform 120ms ease",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      display: "flex",
      alignItems: "center",
    },
    "& > span > i": {
      padding: "0 4px",
      opacity: 0.42,
      fontStyle: "normal",
    },
    "&:hover > span": {
      opacity: 1,
      transform: "translate(0, -50%)",
    },
    "@media (prefers-reduced-motion: reduce)": {
      "& > span": { transition: "none" },
    },
  }),
} as const;
