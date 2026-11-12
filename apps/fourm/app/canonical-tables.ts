import type { Row } from "./data/community.ts";
type Tables = Record<string, Row[]>;
export function canonicalTables(tables: Tables) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(tables)
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([table, rows]) => [
          table,
          rows
            .map((row) =>
              Object.fromEntries(
                Object.entries(row).toSorted(([a], [b]) =>
                  a < b ? -1 : a > b ? 1 : 0,
                ),
              ),
            )
            .toSorted((a, b) => {
              const x = JSON.stringify(a),
                y = JSON.stringify(b);
              return x < y ? -1 : x > y ? 1 : 0;
            }),
        ]),
    ),
  );
}
