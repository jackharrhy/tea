import { css, type Handle, type RemixNode } from "remix/component";

import { adminNavigation } from "./admin-navigation.ts";

const body = css({
  margin: 0,
  minHeight: "100vh",
  color: "#1f2937",
  backgroundColor: "#f9fafb",
  fontFamily: "system-ui, sans-serif",
});
const nav = css({
  backgroundColor: "#111827",
  color: "#fff",
  padding: "12px 0",
  marginBottom: "24px",
  overflowX: "auto",
});
const navInner = css({
  maxWidth: "1024px",
  minWidth: "max-content",
  margin: "0 auto",
  padding: "0 24px",
  display: "flex",
  alignItems: "center",
  gap: "16px",
});
const navGroup = css({
  display: "flex",
  alignItems: "center",
  gap: "12px",
  marginLeft: "16px",
});
const secondaryNavGroup = css({
  display: "flex",
  alignItems: "center",
  gap: "12px",
  paddingLeft: "16px",
  borderLeft: "1px solid #374151",
});
const navLink = css({
  color: "#9ca3af",
  textDecoration: "none",
  fontSize: "14px",
  "&:hover": { color: "#fff" },
});
const secondaryNavLink = css({
  color: "#6b7280",
  textDecoration: "none",
  fontSize: "12px",
  "&:hover": { color: "#fff" },
});
const currentNavLink = css({ color: "#fff" });
const account = css({
  display: "flex",
  alignItems: "center",
  gap: "12px",
  marginLeft: "auto",
});
const accountName = css({
  maxWidth: "160px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#6b7280",
  fontSize: "12px",
});
const brand = css({
  color: "#fff",
  textDecoration: "none",
  fontSize: "16px",
  fontWeight: 700,
});
const main = css({
  maxWidth: "1024px",
  margin: "0 auto",
  padding: "16px 24px",
});
const title = css({ fontSize: "24px", margin: "0 0 24px", fontWeight: 650 });
const summary = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "24px",
  borderBottom: "1px solid #d1d5db",
  paddingBottom: "24px",
});
const summaryItem = css({ minWidth: "140px" });
const count = css({
  display: "block",
  fontSize: "28px",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
});
const label = css({ color: "#4b5563", fontSize: "14px" });
const sectionTitle = css({
  margin: "28px 0 12px",
  fontSize: "18px",
  fontWeight: 600,
});
const table = css({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
});
const th = css({
  padding: "10px 8px",
  color: "#4b5563",
  textAlign: "left",
  fontWeight: 500,
  borderBottom: "1px solid #d1d5db",
});
const td = css({ padding: "12px 8px", borderBottom: "1px solid #e5e7eb" });
const link = css({ color: "#1d4ed8", textDecoration: "none" });
const logout = css({
  padding: 0,
  border: 0,
  color: "#6b7280",
  backgroundColor: "transparent",
  cursor: "pointer",
  font: "inherit",
  fontSize: "12px",
});

export type Viewer = { name: string; isAdmin: boolean };

export function AdminDocument(
  handle: Handle<{
    title: string;
    activeHref: string;
    viewer: Viewer;
    children?: RemixNode;
  }>,
) {
  return () => {
    const { title: pageTitle, activeHref, viewer, children } = handle.props;
    const navigation = adminNavigation(viewer.isAdmin);
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{pageTitle} | Lists admin</title>
        </head>
        <body mix={body}>
          <div id="app-shell">
            <nav mix={nav} aria-label="Admin navigation">
              <div mix={navInner}>
                <a mix={brand} href="/admin/">
                  Lists
                </a>
                <div mix={navGroup}>
                  {navigation.primary.map((item) => (
                    <a
                      mix={[
                        navLink,
                        item.href === activeHref && currentNavLink,
                      ]}
                      href={item.href}
                      aria-current={
                        item.href === activeHref ? "page" : undefined
                      }
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
                <div mix={secondaryNavGroup}>
                  {navigation.secondary.map((item) => (
                    <a
                      mix={[
                        secondaryNavLink,
                        item.href === activeHref && currentNavLink,
                      ]}
                      href={item.href}
                      aria-current={
                        item.href === activeHref ? "page" : undefined
                      }
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
                <div mix={account}>
                  <span mix={accountName}>{viewer.name}</span>
                  <form method="post" action="/admin/logout">
                    <button mix={logout} type="submit">
                      Logout
                    </button>
                  </form>
                </div>
              </div>
            </nav>
            <main mix={main}>{children}</main>
          </div>
        </body>
      </html>
    );
  };
}

export type DashboardData = {
  name: string;
  isAdmin: boolean;
  subscribers: number;
  lists: number;
  campaigns: number;
  recentCampaigns: Array<{
    id: number;
    subject: string;
    status: string;
    createdAt: string;
  }>;
};

export type AdminUserRow = {
  id: number;
  name: string | null;
  email: string;
  role: "owner" | "admin" | "member";
  linked: boolean;
  listCount: number;
};

export function AdminUsers(
  handle: Handle<{ users: AdminUserRow[]; viewer: Viewer }>,
) {
  return () => (
    <AdminDocument
      title="Users"
      activeHref="/admin/users"
      viewer={handle.props.viewer}
    >
      <h1 mix={title}>Users</h1>
      <p mix={label}>
        Access is assigned through central identity. This view shows the local
        Lists accounts and their list assignments.
      </p>
      <table mix={table}>
        <thead>
          <tr>
            <th mix={th}>ID</th>
            <th mix={th}>Account</th>
            <th mix={th}>Role</th>
            <th mix={th}>Identity</th>
            <th mix={th}>Lists</th>
          </tr>
        </thead>
        <tbody>
          {handle.props.users.map((user) => (
            <tr>
              <td mix={td}>{user.id}</td>
              <td mix={td}>{user.name ?? user.email}</td>
              <td mix={td}>{user.role}</td>
              <td mix={td}>{user.linked ? "Linked" : "Unlinked"}</td>
              <td mix={td}>{user.listCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminDocument>
  );
}

export function AdminApiAccess(handle: Handle<{ viewer: Viewer }>) {
  return () => (
    <AdminDocument
      title="API access"
      activeHref="/admin/tokens"
      viewer={handle.props.viewer}
    >
      <h1 mix={title}>API access</h1>
      <p>
        API and MCP access use central Auth. Request an approved client with the
        Lists resource and the operations it needs.
      </p>
      <p>
        Local Lists tokens and standalone OAuth clients are no longer issued.
      </p>
    </AdminDocument>
  );
}

export function AdminDashboard(handle: Handle<{ data: DashboardData }>) {
  return () => {
    const data = handle.props.data;
    return (
      <AdminDocument
        title="Dashboard"
        activeHref="/admin/"
        viewer={{ name: data.name, isAdmin: data.isAdmin }}
      >
        <h1 mix={title}>Dashboard</h1>
        <div mix={summary} aria-label="List overview">
          <div mix={summaryItem}>
            <strong mix={count}>{data.subscribers}</strong>
            <span mix={label}>Active subscribers</span>
          </div>
          <div mix={summaryItem}>
            <strong mix={count}>{data.lists}</strong>
            <span mix={label}>Lists you can access</span>
          </div>
          <div mix={summaryItem}>
            <strong mix={count}>{data.campaigns}</strong>
            <span mix={label}>Campaigns</span>
          </div>
        </div>
        <h2 mix={sectionTitle}>Recent campaigns</h2>
        {data.recentCampaigns.length === 0 ? (
          <p mix={label}>No campaigns yet.</p>
        ) : (
          <table mix={table}>
            <thead>
              <tr>
                <th mix={th}>Subject</th>
                <th mix={th}>Status</th>
                <th mix={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.recentCampaigns.map((campaign) => (
                <tr>
                  <td mix={td}>
                    <a mix={link} href={`/admin/campaigns/${campaign.id}`}>
                      {campaign.subject}
                    </a>
                  </td>
                  <td mix={td}>{campaign.status}</td>
                  <td mix={td}>
                    {new Date(campaign.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AdminDocument>
    );
  };
}
