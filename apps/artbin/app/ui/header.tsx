import { css, type Handle } from "remix/component";

import type { User } from "#db";

import { routes } from "../routes.ts";
import { adminBadgeStyle, theme } from "./styles.ts";

const headerStyle = css({
  alignItems: "center",
  backgroundColor: theme.color.background,
  borderBottom: `1px solid ${theme.color.borderLight}`,
  display: "flex",
  height: "3rem",
  justifyContent: "space-between",
  paddingInline: "1rem",
  position: "sticky",
  top: 0,
  zIndex: 100,
});
const brandStyle = css({
  color: theme.color.text,
  fontSize: "1.125rem",
  letterSpacing: "0.025em",
  textDecoration: "none",
});
const navStyle = css({
  alignItems: "center",
  display: "flex",
  gap: "1rem",
  "@media (max-width: 640px)": { gap: "0.5rem" },
});
const adminLinkStyle = css({
  "&": {
    color: theme.color.background,
    textDecoration: "none",
    padding: "0.35rem 0.5rem",
  },
  "&:hover": { color: theme.color.background, background: "#333" },
  "&:focus-visible": {
    outline: `2px solid ${theme.color.text}`,
    outlineOffset: "3px",
  },
});
const navLinkStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  textDecoration: "none",
  "&:hover": { color: theme.color.text },
});

export interface HeaderProps {
  user?: Pick<User, "username" | "isAdmin"> | null;
}

export function Header(handle: Handle<HeaderProps>) {
  return () => {
    const { user } = handle.props;

    return (
      <header mix={headerStyle}>
        <a
          href={user ? routes.folders.href() : routes.home.href()}
          mix={brandStyle}
        >
          artbin
        </a>
        <nav mix={navStyle} aria-label="Main navigation">
          <a href={routes.cli.href()} mix={navLinkStyle}>
            cli
          </a>
          {user ? (
            <>
              <a href={routes.folders.href()} mix={navLinkStyle}>
                folders
              </a>
              <a href={routes.myUploads.href()} mix={navLinkStyle}>
                my uploads
              </a>
              <a href={routes.settings.index.href()} mix={navLinkStyle}>
                @{user.username}
              </a>
              {user.isAdmin ? (
                <>
                  <a href={routes.admin.inbox.index.href()} mix={navLinkStyle}>
                    inbox
                  </a>
                  <a
                    href={routes.admin.index.href()}
                    mix={[adminBadgeStyle, adminLinkStyle]}
                  >
                    admin
                  </a>
                </>
              ) : null}
            </>
          ) : (
            <a href={routes.login.href()} mix={navLinkStyle}>
              login
            </a>
          )}
        </nav>
      </header>
    );
  };
}
