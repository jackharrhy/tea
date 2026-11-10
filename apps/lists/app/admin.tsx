import { css, type Handle } from "remix/component";

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
  padding: "14px 24px",
});
const navInner = css({
  maxWidth: "1056px",
  margin: "0 auto",
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "18px",
});
const navLink = css({
  color: "#d1d5db",
  textDecoration: "none",
  fontSize: "14px",
});
const brand = css({
  color: "#fff",
  textDecoration: "none",
  fontSize: "16px",
  fontWeight: 700,
});
const main = css({
  maxWidth: "1056px",
  margin: "0 auto",
  padding: "28px 24px",
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
  color: "#d1d5db",
  backgroundColor: "transparent",
  cursor: "pointer",
  font: "inherit",
  fontSize: "14px",
});

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

export function AdminDashboard(handle: Handle<{ data: DashboardData }>) {
  return () => {
    const data = handle.props.data;
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Dashboard | Lists admin</title>
        </head>
        <body mix={body}>
          <nav mix={nav} aria-label="Admin navigation">
            <div mix={navInner}>
              <a mix={brand} href="/admin/">
                Lists
              </a>
              <a mix={navLink} href="/admin/subscribers">
                Subscribers
              </a>
              <a mix={navLink} href="/admin/lists">
                Lists
              </a>
              <a mix={navLink} href="/admin/campaigns">
                Campaigns
              </a>
              <a mix={navLink} href="/admin/inbound">
                Inbound
              </a>
              {data.isAdmin ? (
                <a mix={navLink} href="/admin/dmarc">
                  DMARC
                </a>
              ) : null}
              <a mix={navLink} href="/admin/activity">
                Activity
              </a>
              <a mix={navLink} href="/admin/tags">
                Tags
              </a>
              <a mix={navLink} href="/admin/import">
                Import
              </a>
              {data.isAdmin ? (
                <a mix={navLink} href="/admin/users">
                  Users
                </a>
              ) : null}
              <a mix={navLink} href="/admin/tokens">
                API
              </a>
              <a mix={navLink} href="/admin/templates">
                Templates
              </a>
              <a mix={navLink} href="/design">
                Design
              </a>
              <span mix={label}>{data.name}</span>
              <form method="post" action="/admin/logout">
                <button mix={logout} type="submit">
                  Logout
                </button>
              </form>
            </div>
          </nav>
          <main mix={main}>
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
                        {new Date(campaign.createdAt).toLocaleDateString(
                          "en-US",
                          { year: "numeric", month: "short", day: "numeric" },
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </main>
        </body>
      </html>
    );
  };
}
