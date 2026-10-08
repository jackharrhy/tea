import { css, type Handle } from "remix/component";

import { theme } from "./styles.ts";

const tabsStyle = css({
  borderBottom: `1px solid ${theme.color.borderLight}`,
  display: "flex",
  marginBottom: "1rem",
  overflowX: "auto",
  overflowY: "hidden",
});
const tabStyle = css({
  borderBottom: "2px solid transparent",
  color: theme.color.muted,
  flexShrink: 0,
  fontSize: "0.875rem",
  marginBottom: "-1px",
  padding: "0.5rem 1rem",
  textDecoration: "none",
  transition: "color 150ms",
  whiteSpace: "nowrap",
  "&:hover": { color: theme.color.text, textDecoration: "none" },
});
const activeTabStyle = css({
  borderBottomColor: theme.color.text,
  color: theme.color.text,
  fontWeight: 500,
});
const countStyle = css({
  color: theme.color.muted,
  fontSize: "0.75rem",
  marginLeft: "0.375rem",
});
const breadcrumbsStyle = css({
  color: theme.color.muted,
  display: "flex",
  flexWrap: "wrap",
  fontSize: "0.75rem",
  gap: "0.35rem",
  marginBottom: "1rem",
});
const breadcrumbLinkStyle = css({
  color: theme.color.muted,
  textDecoration: "none",
  "&:hover": { color: theme.color.text },
});
const separatorStyle = css({ color: theme.color.faint });

export interface TabItem {
  id: string;
  href: string;
  label: string;
  count?: number | string;
}

export function Tabs(
  handle: Handle<{ items: TabItem[]; activeId: string; label: string }>,
) {
  return () => (
    <nav mix={tabsStyle} aria-label={handle.props.label}>
      {handle.props.items.map((item) => (
        <a
          key={item.id}
          href={item.href}
          aria-current={item.id === handle.props.activeId ? "page" : undefined}
          mix={[
            tabStyle,
            item.id === handle.props.activeId ? activeTabStyle : undefined,
          ]}
        >
          {item.label}
          {item.count === undefined ? null : (
            <span mix={countStyle}>{item.count}</span>
          )}
        </a>
      ))}
    </nav>
  );
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs(
  handle: Handle<{ items: BreadcrumbItem[]; label?: string }>,
) {
  return () => (
    <nav aria-label={handle.props.label ?? "Breadcrumb"} mix={breadcrumbsStyle}>
      {handle.props.items.map((item, index) => (
        <span key={`${index}-${item.label}`}>
          {index ? (
            <span aria-hidden="true" mix={separatorStyle}>
              /
            </span>
          ) : null}
          {index ? " " : null}
          {item.href ? (
            <a href={item.href} mix={breadcrumbLinkStyle}>
              {item.label}
            </a>
          ) : (
            <span
              aria-current={
                index === handle.props.items.length - 1 ? "page" : undefined
              }
            >
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
