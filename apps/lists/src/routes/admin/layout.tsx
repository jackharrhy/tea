/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import { schema } from "../../db";
import { assetUrl } from "../../assets";
import { testSubscriberIds } from "../../services/campaign-audience";
import { adminNavigation } from "../../../app/admin-navigation";

// ---------------------------------------------------------------------------
// Flash helpers
// ---------------------------------------------------------------------------

export function setFlash(c: any, message: string) {
  c.cookie.flash.set({
    value: encodeURIComponent(message),
    path: "/",
    httpOnly: true,
    maxAge: 10,
    sameSite: "lax",
  });
}

export function getFlash(c: any): string | undefined {
  const val = c.cookie.flash.value;
  if (typeof val === "string") {
    c.cookie.flash.remove();
    return decodeURIComponent(val);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Layout & components
// ---------------------------------------------------------------------------

export type User = typeof schema.users.$inferSelect;

function NavLink({
  href,
  children,
  secondary = false,
  boost = true,
}: {
  href: string;
  children: string;
  secondary?: boolean;
  boost?: boolean;
}) {
  return (
    <a
      href={href}
      hx-boost={boost ? undefined : "false"}
      class={`nav-link whitespace-nowrap text-sm no-underline hover:text-white ${secondary ? "text-xs text-gray-500" : "text-gray-400"}`}
    >
      {children}
    </a>
  );
}

export function AdminLayout({
  title,
  children,
  flash,
  user,
}: {
  title: string;
  children: any;
  flash?: string;
  user?: User;
}) {
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  const navigation = adminNavigation(isAdmin);
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title safe>{title} - Lists Admin</title>
        <link rel="stylesheet" href={assetUrl("/static/styles.css")} />
        <script src={assetUrl("/static/app.js")} defer></script>
      </head>
      <body
        class="font-sans text-gray-900 bg-gray-50 m-0 p-0 leading-relaxed"
        hx-boost="true"
        hx-target="#app-shell"
        hx-select="#app-shell"
        hx-swap="outerHTML"
        hx-push-url="true"
        hx-indicator="#global-progress"
      >
        <div
          id="global-progress"
          class="htmx-indicator"
          role="progressbar"
          aria-label="Loading"
        ></div>
        <div id="app-shell">
          <nav
            class="bg-gray-900 py-3 mb-6 overflow-x-auto"
            aria-label="Admin navigation"
          >
            <div class="max-w-5xl min-w-max mx-auto px-4 sm:px-6 flex items-center gap-4">
              <a
                href="/admin/"
                hx-boost="false"
                class="nav-link text-white font-bold text-base no-underline"
              >
                Lists
              </a>

              <div class="flex items-center gap-3 ml-4">
                {navigation.primary.map((item) => (
                  <NavLink href={item.href} boost={!item.fullPage}>
                    {item.label}
                  </NavLink>
                ))}
              </div>

              <div class="flex items-center gap-3 border-l border-gray-700 pl-4">
                {navigation.secondary.map((item) => (
                  <NavLink href={item.href} secondary boost={!item.fullPage}>
                    {item.label}
                  </NavLink>
                ))}
              </div>

              <div class="flex items-center gap-3 ml-auto">
                <span safe class="max-w-40 truncate text-gray-500 text-xs">
                  {user?.name ?? user?.email ?? ""}
                </span>
                <form method="post" action="/admin/logout" class="m-0">
                  <button
                    type="submit"
                    class="bg-transparent text-gray-500 border-none cursor-pointer text-xs p-0 hover:text-white"
                  >
                    Logout
                  </button>
                </form>
              </div>
            </div>
          </nav>
          <main class="max-w-5xl mx-auto px-4 sm:px-6 py-4">
            {flash && (
              <div
                id="flash-msg"
                class="bg-green-100 border border-green-300 text-green-800 px-4 py-3 rounded-md mb-4 text-sm flex items-center justify-between"
              >
                <span>{flash}</span>
                <button
                  onclick="this.closest('#flash-msg').remove()"
                  type="button"
                  class="bg-transparent border-none cursor-pointer text-green-600 hover:text-green-800 text-lg leading-none p-0 ml-2"
                >
                  &times;
                </button>
              </div>
            )}
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

export function displayName(sub: {
  firstName?: string | null;
  lastName?: string | null;
}): string {
  return [sub.firstName, sub.lastName].filter(Boolean).join(" ") || "\u2014";
}

export function extractEmail(addr: string): string {
  const match = addr.match(/<([^>]+)>/);
  return match?.[1] ?? addr.trim();
}

function verdictChip(label: string, value?: string | null) {
  if (!value) return null;
  const pass = value === "PASS";
  return (
    <span
      class={`text-[10px] font-medium ${pass ? "text-green-600" : "text-red-600"}`}
    >
      {label}
      {pass ? "\u2713" : "\u2717"}
    </span>
  );
}

export function VerdictChips({
  spf,
  dkim,
  dmarc,
}: {
  spf?: string | null;
  dkim?: string | null;
  dmarc?: string | null;
}) {
  return (
    <span class="flex items-center gap-1.5">
      {verdictChip("SPF", spf)}
      {verdictChip("DKIM", dkim)}
      {verdictChip("DMARC", dmarc)}
    </span>
  );
}

export function CampaignBadge({ status }: { status: string }) {
  const base = "inline-block px-2.5 py-0.5 rounded-full text-xs font-medium";
  const cls =
    status === "draft"
      ? `${base} bg-amber-100 text-amber-800`
      : status === "sending"
        ? `${base} bg-blue-100 text-blue-800`
        : status === "failed"
          ? `${base} bg-red-100 text-red-800`
          : status === "scheduled"
            ? `${base} bg-purple-100 text-purple-800`
            : `${base} bg-green-100 text-green-800`;
  return <span class={cls}>{status}</span>;
}

export function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA");
}

export function fmtDateTime(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return `${dt.toLocaleDateString("en-CA")} ${dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function describeAudience(
  campaign: {
    audienceType: string;
    audienceId: number | null;
    audienceData: string | null;
  },
  lists: Map<number, string>,
  tags: Map<number, string>,
): string {
  if (campaign.audienceType === "list") {
    const listName = lists.get(campaign.audienceId!) ?? "Unknown list";
    const ids = testSubscriberIds(campaign.audienceType, campaign.audienceData);
    return ids ? `Test: ${ids.length} selected from ${listName}` : listName;
  }
  if (campaign.audienceType === "all") return "All subscribers";
  if (campaign.audienceType === "tag")
    return `Tag: ${tags.get(campaign.audienceId!) ?? "Unknown"}`;
  if (campaign.audienceType === "subscribers") {
    const ids = campaign.audienceData
      ? (JSON.parse(campaign.audienceData) as number[])
      : [];
    return `${ids.length} specific`;
  }
  return "Unknown";
}
