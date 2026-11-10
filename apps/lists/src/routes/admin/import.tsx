/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import type { App } from "../../http";
import { eq } from "drizzle-orm";
import type { Db } from "../../db";
import { schema } from "../../db";
import type { Config } from "../../config";
import { getAccessibleLists } from "../../auth";
import { createSubscriber, confirmSubscriber } from "../../services/subscriber";
import { logEvent } from "../../services/events";
import { AdminLayout, getFlash, type User } from "./layout";
import {
  Button,
  Input,
  Label,
  FormGroup,
  Table,
  Th,
  Td,
  Card,
  PageHeader,
} from "./ui";

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (const line of lines) {
    const row: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        row.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    rows.push(row);
  }
  return rows;
}

export function mountImportRoutes(app: App, db: Db, _config: Config) {
  app.get("/import", (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    return c.html(
      <AdminLayout title="Import Subscribers" user={user} flash={flash}>
        <PageHeader title="Import subscribers" />
        <Card>
          <form
            method="post"
            action="/admin/import/upload"
            enctype="multipart/form-data"
          >
            <FormGroup>
              <Label for="csv">CSV File</Label>
              <Input type="file" id="csv" name="csv" accept=".csv" required />
            </FormGroup>
            <Button type="submit">Upload CSV</Button>
          </form>
        </Card>
      </AdminLayout>,
    );
  });

  app.post("/import/upload", async (c) => {
    const user = c.user as User;
    const body = c.body as Record<string, any>;
    const file = body["csv"];

    if (!file || typeof file === "string") {
      return c.redirect("/admin/import");
    }

    const text = await (file as File).text();
    const allRows = parseCSV(text);

    if (allRows.length < 2) {
      return c.html(
        <AdminLayout title="Import Subscribers" user={user}>
          <PageHeader title="Import subscribers" />
          <div class="bg-red-100 border border-red-300 text-red-800 px-4 py-3 rounded-md mb-4 text-sm">
            CSV file must contain a header row and at least one data row.
          </div>
          <a href="/admin/import" class="text-blue-600 hover:text-blue-800">
            Back to Import
          </a>
        </AdminLayout>,
      );
    }

    const headers = allRows[0]!;
    const dataRows = allRows.slice(1);
    const previewRows = dataRows.slice(0, 5);

    // Auto-detect column mappings
    const autoMappings = headers.map((h) => {
      const lower = h.toLowerCase();
      if (lower.includes("email") || lower.includes("mail")) return "email";
      if (lower.includes("first") && lower.includes("name")) return "firstName";
      if (lower.includes("last") && lower.includes("name")) return "lastName";
      if (lower.includes("name")) return "firstName";
      return "ignore";
    });

    // Get accessible lists
    const allLists = getAccessibleLists(db, user);

    return c.html(
      <AdminLayout title="Map Columns" user={user}>
        <PageHeader title="Map columns" />
        <form method="post" action="/admin/import/process">
          <Card class="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  {headers.map((_, i) => (
                    <Th>
                      <select
                        name={`col_${i}`}
                        class="w-full px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option
                          value="ignore"
                          selected={autoMappings[i] === "ignore"}
                        >
                          Ignore
                        </option>
                        <option
                          value="email"
                          selected={autoMappings[i] === "email"}
                        >
                          Email
                        </option>
                        <option
                          value="firstName"
                          selected={autoMappings[i] === "firstName"}
                        >
                          First Name
                        </option>
                        <option
                          value="lastName"
                          selected={autoMappings[i] === "lastName"}
                        >
                          Last Name
                        </option>
                      </select>
                    </Th>
                  ))}
                </tr>
                <tr>
                  {headers.map((h) => (
                    <th class="bg-gray-50 px-4 py-2 text-left text-xs font-medium text-gray-700 border-b border-gray-200">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr>
                    {headers.map((_, i) => (
                      <Td>{row[i] ?? ""}</Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
            {dataRows.length > 5 && (
              <p class="text-sm text-gray-500">
                Showing 5 of {dataRows.length} rows.
              </p>
            )}
          </Card>

          {allLists.length > 0 && (
            <Card>
              <p class="text-sm font-medium text-gray-700 mb-2">
                Import to lists
              </p>
              {allLists.map((list) => (
                <label class="flex items-center gap-2 text-sm text-gray-800 mb-1">
                  <input type="checkbox" name="lists" value={list.slug} />
                  {list.name}
                </label>
              ))}
            </Card>
          )}

          <Card>
            <label class="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" name="preconfirm" value="1" />
              Pre-confirm subscribers (skip double opt-in)
            </label>
          </Card>

          <Card>
            <Label>Apply tag to all imported subscribers (optional)</Label>
            <Input
              type="text"
              name="importTag"
              placeholder="e.g. imported-2026-03"
            />
          </Card>

          <input
            type="hidden"
            name="csvData"
            value={JSON.stringify(dataRows)}
          />
          <input type="hidden" name="headers" value={JSON.stringify(headers)} />

          <Button type="submit">Import {dataRows.length} subscribers</Button>
        </form>
      </AdminLayout>,
    );
  });

  app.post("/import/process", async (c) => {
    const user = c.user as User;
    const body = c.body as Record<string, any>;

    let dataRows: string[][];
    let headers: string[];
    try {
      dataRows = JSON.parse(body["csvData"] as string);
      headers = JSON.parse(body["headers"] as string);
    } catch {
      return c.redirect("/admin/import");
    }

    // Determine column mappings
    let emailCol = -1;
    let firstNameCol = -1;
    let lastNameCol = -1;
    for (let i = 0; i < headers.length; i++) {
      const mapping = body[`col_${i}`] as string;
      if (mapping === "email") emailCol = i;
      if (mapping === "firstName") firstNameCol = i;
      if (mapping === "lastName") lastNameCol = i;
    }

    if (emailCol === -1) {
      return c.html(
        <AdminLayout title="Import Error" user={user}>
          <PageHeader title="Import error" />
          <div class="bg-red-100 border border-red-300 text-red-800 px-4 py-3 rounded-md mb-4 text-sm">
            No column mapped to "email". Please go back and map at least one
            column as email.
          </div>
          <a href="/admin/import" class="text-blue-600 hover:text-blue-800">
            Back to Import
          </a>
        </AdminLayout>,
      );
    }

    // Get list slugs
    let listSlugs: string[] = [];
    if (body["lists"]) {
      listSlugs = Array.isArray(body["lists"])
        ? (body["lists"] as string[])
        : [body["lists"] as string];
    }

    const preconfirm = body["preconfirm"] === "1";
    const importTag = String(body["importTag"] ?? "").trim();

    // Find or create the tag once before the loop
    let tagId: number | null = null;
    if (importTag) {
      const existing = db
        .select()
        .from(schema.tags)
        .where(eq(schema.tags.name, importTag))
        .get();
      if (existing) {
        tagId = existing.id;
      } else {
        const created = db
          .insert(schema.tags)
          .values({ name: importTag })
          .returning({ id: schema.tags.id })
          .get();
        tagId = created.id;
      }
    }

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of dataRows) {
      const email = (row[emailCol] ?? "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        errors++;
        continue;
      }

      const firstName =
        firstNameCol >= 0 ? (row[firstNameCol] ?? "").trim() || null : null;
      const lastName =
        lastNameCol >= 0 ? (row[lastNameCol] ?? "").trim() || null : null;

      try {
        // Check if subscriber already exists before creating
        const existingBefore = db
          .select()
          .from(schema.subscribers)
          .where(eq(schema.subscribers.email, email))
          .get();

        const subscriber = createSubscriber(
          db,
          email,
          firstName,
          lastName,
          listSlugs,
        );

        if (existingBefore) {
          skipped++;
        } else {
          imported++;
        }

        if (preconfirm) {
          confirmSubscriber(db, subscriber.unsubscribeToken);
        }

        if (tagId !== null) {
          db.insert(schema.subscriberTags)
            .values({ subscriberId: subscriber.id, tagId })
            .onConflictDoNothing()
            .run();
        }
      } catch {
        errors++;
      }
    }

    logEvent(db, {
      type: "admin.import_completed",
      detail: `Imported ${imported}, skipped ${skipped}, errors ${errors}`,
      userId: user.id,
    });

    return c.html(
      <AdminLayout title="Import Complete" user={user}>
        <PageHeader title="Import complete" />
        <Card>
          <div class="flex gap-4 mb-4">
            <div class="inline-flex flex-col items-center bg-green-50 border border-green-200 rounded-lg px-6 py-4 min-w-[120px] text-center">
              <span class="text-3xl font-bold text-green-600">{imported}</span>
              <span class="text-xs text-gray-500 uppercase tracking-wide">
                Imported
              </span>
            </div>
            <div class="inline-flex flex-col items-center bg-amber-50 border border-amber-200 rounded-lg px-6 py-4 min-w-[120px] text-center">
              <span class="text-3xl font-bold text-amber-600">{skipped}</span>
              <span class="text-xs text-gray-500 uppercase tracking-wide">
                Skipped
              </span>
            </div>
            <div class="inline-flex flex-col items-center bg-red-50 border border-red-200 rounded-lg px-6 py-4 min-w-[120px] text-center">
              <span class="text-3xl font-bold text-red-600">{errors}</span>
              <span class="text-xs text-gray-500 uppercase tracking-wide">
                Errors
              </span>
            </div>
          </div>
          <a
            href="/admin/subscribers"
            class="text-blue-600 hover:text-blue-800"
          >
            View subscribers
          </a>
        </Card>
      </AdminLayout>,
    );
  });
}
