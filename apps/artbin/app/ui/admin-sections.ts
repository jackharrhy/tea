import { routes } from "../routes.ts";

export const adminSections = [
  {
    label: "Daily work",
    items: [
      {
        id: "jobs",
        label: "Jobs",
        href: routes.admin.jobs.index.href(),
        description:
          "Follow imports and maintenance tasks. Inspect failures or cancel queued work.",
      },
      {
        id: "inbox",
        label: "Inbox",
        href: routes.admin.inbox.index.href(),
        description: "Review uploaded files and choose where they belong.",
      },
      {
        id: "import",
        label: "Import",
        href: routes.admin.import.index.href(),
        description:
          "Bring in online collections and local folders, or regenerate previews.",
      },
      {
        id: "archives",
        label: "Archives",
        href: routes.admin.archives.index.href(),
        description:
          "Find archives on the server and queue their contents for extraction.",
      },
    ],
  },
  {
    label: "Management",
    items: [
      {
        id: "orphans",
        label: "Orphans",
        href: routes.admin.orphans.index.href(),
        description:
          "Reconcile files on disk that are missing from the library index.",
      },
      {
        id: "scan-settings",
        label: "Scan settings",
        href: routes.admin.scanSettings.index.href(),
        description: "Configure archive scanning and import rules.",
      },
      {
        id: "users",
        label: "Users",
        href: routes.admin.users.href(),
        description: "See registered accounts and their access roles.",
      },
      {
        id: "mcp",
        label: "MCP",
        href: routes.admin.mcp.href(),
        description:
          "Connect administrative tools to Artbin's private MCP server.",
      },
    ],
  },
] as const;

export type AdminTab =
  | "overview"
  | (typeof adminSections)[number]["items"][number]["id"];
