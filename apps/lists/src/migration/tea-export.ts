import type { Database } from "bun:sqlite";

export const TEA_EXPORT_FORMAT = "lists-tea-export";
export const TEA_EXPORT_VERSION = 1;

export const domainTables = [
  "users",
  "lists",
  "user_lists",
  "subscribers",
  "subscriber_lists",
  "tags",
  "subscriber_tags",
  "email_templates",
  "campaigns",
  "campaign_sends",
  "delivery_events",
  "dmarc_reports",
  "dmarc_report_records",
  "dmarc_ingestions",
  "messages",
  "events",
] as const;

type TeaExportTable = (typeof domainTables)[number];

export type TeaExportBundle = {
  format: typeof TEA_EXPORT_FORMAT;
  version: typeof TEA_EXPORT_VERSION;
  exportedAt: string;
  source: {
    application: "lists";
    latestMigration: "0023_mutable-email-templates";
  };
  exclusions: readonly [
    "sessions",
    "api_tokens",
    "oauth_clients",
    "oauth_authorization_codes",
    "oauth_refresh_tokens",
  ];
  reconciliations: {
    danglingEventReferences: {
      users: number;
      subscribers: number;
      campaigns: number;
      messages: number;
    };
  };
  tables: Record<TeaExportTable, Record<string, unknown>[]>;
};

function verifyDatabase(sqlite: Database) {
  const integrity = sqlite.query("PRAGMA integrity_check").get() as {
    integrity_check: string;
  } | null;
  if (integrity?.integrity_check !== "ok") {
    throw new Error(
      `SQLite integrity check failed: ${integrity?.integrity_check ?? "no result"}`,
    );
  }

  const foreignKeyErrors = sqlite
    .query("PRAGMA foreign_key_check")
    .all() as Array<{
    table: string;
    rowid: number;
    parent: string;
    fkid: number;
  }>;
  const allowedEventParents = new Set([
    "users",
    "subscribers",
    "campaigns",
    "messages",
  ]);
  const unexpected = foreignKeyErrors.filter(
    (error) =>
      error.table !== "events" || !allowedEventParents.has(error.parent),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `SQLite foreign key check failed with ${unexpected.length} unexpected violation(s)`,
    );
  }

  return Object.fromEntries(
    [...allowedEventParents].map((parent) => [
      parent,
      foreignKeyErrors.filter(
        (error) => error.table === "events" && error.parent === parent,
      ).length,
    ]),
  ) as TeaExportBundle["reconciliations"]["danglingEventReferences"];
}

const normalizedEventsQuery = `
  SELECT
    e.id,
    e.type,
    e.detail,
    e.meta,
    CASE WHEN u.id IS NULL THEN NULL ELSE e.user_id END AS user_id,
    CASE WHEN s.id IS NULL THEN NULL ELSE e.subscriber_id END AS subscriber_id,
    CASE WHEN c.id IS NULL THEN NULL ELSE e.campaign_id END AS campaign_id,
    CASE WHEN m.id IS NULL THEN NULL ELSE e.message_id END AS message_id,
    e.created_at
  FROM events e
  LEFT JOIN users u ON u.id = e.user_id
  LEFT JOIN subscribers s ON s.id = e.subscriber_id
  LEFT JOIN campaigns c ON c.id = e.campaign_id
  LEFT JOIN messages m ON m.id = e.message_id
  ORDER BY e.id
`;

export function createTeaExport(
  sqlite: Database,
  exportedAt = new Date().toISOString(),
): TeaExportBundle {
  const danglingEventReferences = verifyDatabase(sqlite);
  sqlite.exec("BEGIN");
  try {
    const tables = Object.fromEntries(
      domainTables.map((table) => [
        table,
        sqlite
          .query(
            table === "users"
              ? "SELECT id, email, name, role, created_at FROM users ORDER BY id"
              : table === "events"
                ? normalizedEventsQuery
                : `SELECT * FROM ${table} ORDER BY rowid`,
          )
          .all(),
      ]),
    ) as TeaExportBundle["tables"];
    sqlite.exec("COMMIT");

    return {
      format: TEA_EXPORT_FORMAT,
      version: TEA_EXPORT_VERSION,
      exportedAt,
      source: {
        application: "lists",
        latestMigration: "0023_mutable-email-templates",
      },
      exclusions: [
        "sessions",
        "api_tokens",
        "oauth_clients",
        "oauth_authorization_codes",
        "oauth_refresh_tokens",
      ],
      reconciliations: { danglingEventReferences },
      tables,
    };
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

export function teaExportCounts(bundle: TeaExportBundle) {
  return Object.fromEntries(
    domainTables.map((table) => [table, bundle.tables[table].length]),
  ) as Record<TeaExportTable, number>;
}
