import { eq } from "drizzle-orm";
import { css, type Handle } from "remix/component";
import { createController } from "remix/router";
import { z } from "zod";

import { getAccessibleLists } from "../src/auth.ts";
import { schema, type Db } from "../src/db/index.ts";
import { logEvent } from "../src/services/events.ts";
import {
  confirmSubscriber,
  createSubscriber,
} from "../src/services/subscriber.ts";
import { AdminDocument, type Viewer } from "./admin.tsx";
import { routes } from "./routes.ts";

type User = Pick<
  typeof schema.users.$inferSelect,
  "id" | "role" | "name" | "email"
>;
type List = typeof schema.lists.$inferSelect;
type Stage = {
  userId: number;
  expiresAt: number;
  headers: string[];
  rows: string[][];
};
const uploads = new Map<string, Stage>();
const title = css({ fontSize: "24px", fontWeight: 700, margin: "0 0 20px" });
const field = css({
  display: "grid",
  gap: "6px",
  marginBottom: "16px",
  fontSize: "14px",
});
const input = css({
  boxSizing: "border-box",
  padding: "8px 10px",
  minHeight: "38px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  backgroundColor: "#fff",
  color: "#111827",
  font: "inherit",
});
const action = css({
  padding: "8px 14px",
  border: "1px solid #1f2937",
  borderRadius: "6px",
  backgroundColor: "#1f2937",
  color: "#fff",
  font: "inherit",
  cursor: "pointer",
});
const table = css({
  borderCollapse: "collapse",
  width: "100%",
  fontSize: "14px",
});
const tableCell = css({
  padding: "8px",
  borderBottom: "1px solid #e5e7eb",
  textAlign: "left",
});
const section = css({
  fontSize: "18px",
  fontWeight: 600,
  margin: "24px 0 10px",
});
const check = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "8px",
});
const error = css({
  padding: "12px",
  backgroundColor: "#fef2f2",
  color: "#991b1b",
});
const link = css({ color: "#1d4ed8", textDecoration: "none" });

function viewer(user: User): Viewer {
  return { name: user.name ?? user.email, isAdmin: user.role !== "member" };
}
function parseCSV(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
function mapping(header: string) {
  const value = header.toLowerCase();
  if (value.includes("mail")) return "email";
  if ((value.includes("first") && value.includes("name")) || value === "name")
    return "firstName";
  if (value.includes("last") && value.includes("name")) return "lastName";
  return "ignore";
}
function Start(handle: Handle<{ viewer: Viewer; problem?: string }>) {
  return () => (
    <AdminDocument
      title="Import subscribers"
      activeHref="/admin/import"
      viewer={handle.props.viewer}
    >
      <h1 mix={title}>Import subscribers</h1>
      {handle.props.problem ? (
        <p mix={error} role="alert">
          {handle.props.problem}
        </p>
      ) : null}
      <form
        method="post"
        action="/admin/import/upload"
        encType="multipart/form-data"
      >
        <label mix={field}>
          CSV file
          <input
            mix={input}
            type="file"
            name="csv"
            accept=".csv,text/csv"
            required
          />
        </label>
        <button mix={action} type="submit">
          Review CSV
        </button>
      </form>
    </AdminDocument>
  );
}
function Review(
  handle: Handle<{
    viewer: Viewer;
    stageId: string;
    stage: Stage;
    lists: List[];
  }>,
) {
  const { stage, stageId, lists } = handle.props;
  return () => (
    <AdminDocument
      title="Map columns"
      activeHref="/admin/import"
      viewer={handle.props.viewer}
    >
      <h1 mix={title}>Map columns</h1>
      <p>
        {stage.rows.length} rows found. Review the first five before importing.
      </p>
      <form method="post" action="/admin/import/process">
        <input type="hidden" name="stageId" value={stageId} />
        <table mix={table}>
          <thead>
            <tr>
              {stage.headers.map((header, index) => (
                <th mix={tableCell}>
                  <select mix={input} name={`col_${index}`}>
                    {["ignore", "email", "firstName", "lastName"].map(
                      (value) => (
                        <option
                          value={value}
                          selected={mapping(header) === value}
                        >
                          {value}
                        </option>
                      ),
                    )}
                  </select>
                </th>
              ))}
            </tr>
            <tr>
              {stage.headers.map((header) => (
                <th mix={tableCell}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stage.rows.slice(0, 5).map((row) => (
              <tr>
                {stage.headers.map((_, index) => (
                  <td mix={tableCell}>{row[index] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <h2 mix={section}>Lists</h2>
        {lists.map((list) => (
          <label mix={check}>
            <input type="checkbox" name="lists" value={list.slug} />
            {list.name}
          </label>
        ))}
        <label mix={check}>
          <input type="checkbox" name="preconfirm" value="1" />
          Pre-confirm subscribers
        </label>
        <label mix={field}>
          Apply tag (optional)
          <input mix={input} name="importTag" />
        </label>
        <button mix={action} type="submit">
          Import {stage.rows.length} subscribers
        </button>
      </form>
    </AdminDocument>
  );
}
function Result(
  handle: Handle<{
    viewer: Viewer;
    imported: number;
    skipped: number;
    errors: number;
  }>,
) {
  return () => (
    <AdminDocument
      title="Import complete"
      activeHref="/admin/import"
      viewer={handle.props.viewer}
    >
      <h1 mix={title}>Import complete</h1>
      <p>
        {handle.props.imported} imported · {handle.props.skipped} existing ·{" "}
        {handle.props.errors} invalid
      </p>
      <a mix={link} href="/admin/subscribers">
        View subscribers
      </a>
    </AdminDocument>
  );
}

export function createAdminImportController(db: Db, user: User) {
  const account = viewer(user);
  return createController(routes.admin.import, {
    actions: {
      index(context) {
        return context.render(<Start viewer={account} />);
      },
      async upload(context) {
        const form = await context.request.formData();
        const file = form.get("csv");
        if (!(file instanceof File) || file.size === 0 || file.size > 5_000_000)
          return context.render(
            <Start viewer={account} problem="Choose a CSV under 5 MB." />,
            {
              status: 400,
            },
          );
        let rows: string[][];
        try {
          rows = parseCSV(await file.text());
        } catch (cause) {
          return context.render(
            <Start
              viewer={account}
              problem={cause instanceof Error ? cause.message : "Invalid CSV."}
            />,
            { status: 400 },
          );
        }
        if (rows.length < 2 || rows.length > 50_001 || rows[0]!.length > 100)
          return context.render(
            <Start
              viewer={account}
              problem="CSV needs a header and 1 to 50,000 rows, with at most 100 columns."
            />,
            { status: 400 },
          );
        for (const [key, value] of uploads)
          if (value.expiresAt < Date.now()) uploads.delete(key);
        if (uploads.size >= 10) uploads.delete(uploads.keys().next().value!);
        const stageId = crypto.randomUUID();
        const stage = {
          userId: user.id,
          expiresAt: Date.now() + 15 * 60_000,
          headers: rows[0]!,
          rows: rows.slice(1),
        };
        uploads.set(stageId, stage);
        return context.render(
          <Review
            viewer={account}
            stageId={stageId}
            stage={stage}
            lists={getAccessibleLists(db, user)}
          />,
        );
      },
      async process(context) {
        const form = await context.request.formData();
        const key = String(form.get("stageId") ?? "");
        const stage = uploads.get(key);
        if (!stage || stage.userId !== user.id || stage.expiresAt < Date.now())
          return context.render(
            <Start
              viewer={account}
              problem="Upload expired. Choose the CSV again."
            />,
            { status: 400 },
          );
        const columns = stage.headers.map((_, index) =>
          String(form.get(`col_${index}`) ?? "ignore"),
        );
        const emailIndex = columns.indexOf("email");
        if (emailIndex < 0)
          return context.render(
            <Start viewer={account} problem="Map one column to email." />,
            {
              status: 400,
            },
          );
        const allowed = new Set(
          getAccessibleLists(db, user).map((list) => list.slug),
        );
        const lists = form
          .getAll("lists")
          .filter((item): item is string => typeof item === "string");
        if (lists.some((slug) => !allowed.has(slug)))
          return new Response("Forbidden", { status: 403 });
        if (user.role === "member" && lists.length === 0)
          return new Response("Select a list", { status: 400 });
        const tagName = String(form.get("importTag") ?? "").trim();
        if (tagName.length > 255)
          return new Response("Invalid tag", { status: 400 });
        uploads.delete(key);
        let tagId: number | null = null;
        if (tagName)
          tagId =
            db
              .select({ id: schema.tags.id })
              .from(schema.tags)
              .where(eq(schema.tags.name, tagName))
              .get()?.id ??
            db
              .insert(schema.tags)
              .values({ name: tagName })
              .returning({ id: schema.tags.id })
              .get().id;
        const firstNameIndex = columns.indexOf("firstName"),
          lastNameIndex = columns.indexOf("lastName");
        let imported = 0,
          skipped = 0,
          errors = 0;
        for (const row of stage.rows) {
          const email = (row[emailIndex] ?? "").trim().toLowerCase();
          if (!z.email().safeParse(email).success) {
            errors++;
            continue;
          }
          try {
            const exists = !!db
              .select({ id: schema.subscribers.id })
              .from(schema.subscribers)
              .where(eq(schema.subscribers.email, email))
              .get();
            const subscriber = createSubscriber(
              db,
              email,
              firstNameIndex < 0 ? null : row[firstNameIndex]?.trim() || null,
              lastNameIndex < 0 ? null : row[lastNameIndex]?.trim() || null,
              lists,
            );
            if (exists) skipped++;
            else imported++;
            if (form.get("preconfirm") === "1")
              confirmSubscriber(db, subscriber.unsubscribeToken);
            if (tagId !== null)
              db.insert(schema.subscriberTags)
                .values({ subscriberId: subscriber.id, tagId })
                .onConflictDoNothing()
                .run();
          } catch {
            errors++;
          }
        }
        logEvent(db, {
          type: "admin.import_completed",
          detail: `Imported ${imported}, skipped ${skipped}, errors ${errors}`,
          userId: user.id,
        });
        return context.render(
          <Result
            viewer={account}
            imported={imported}
            skipped={skipped}
            errors={errors}
          />,
        );
      },
    },
  });
}
