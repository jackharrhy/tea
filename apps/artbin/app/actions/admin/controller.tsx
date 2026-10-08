import { count, desc, eq } from "drizzle-orm";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import { files, jobs, users } from "#db";
import { db } from "#db/connection.server";

import { mcpTools } from "../../operations/catalog.ts";

import { requireAdmin } from "../../middleware/auth.ts";
import { routes } from "../../routes.ts";
import { AdminPage } from "../../ui/admin-page.tsx";
import { Dashboard } from "./dashboard.tsx";
import {
  Badge,
  DataTable,
  EmptyState,
  TableCell,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
} from "../../ui/primitives.tsx";

export default createController(routes.admin, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const [jobCounts, [inbox]] = await Promise.all([
        db
          .select({ status: jobs.status, count: count() })
          .from(jobs)
          .groupBy(jobs.status),
        db
          .select({ count: count() })
          .from(files)
          .where(eq(files.status, "pending")),
      ]);
      const counts = new Map(jobCounts.map((row) => [row.status, row.count]));
      return context.render(
        <AdminPage
          user={context.user}
          active="overview"
          title="Overview"
          description="Review uploads, follow background work, and maintain the library."
        >
          <Dashboard
            running={counts.get("running") ?? 0}
            queued={counts.get("pending") ?? 0}
            failed={counts.get("failed") ?? 0}
            pendingFiles={inbox?.count ?? 0}
          />
        </AdminPage>,
      );
    },
    mcp(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const endpoint = `${process.env.ARTBIN_URL ?? "http://localhost:5175"}/mcp`;
      return context.render(
        <AdminPage user={context.user} active="mcp" title="MCP">
          <section>
            <h2>Administrator MCP server</h2>
            <p>
              This private endpoint exposes the same canonical folder, job, and
              import operations used by Artbin's CLI and administrative
              interface.
            </p>
            <dl>
              <dt>Endpoint</dt>
              <dd>
                <code>{endpoint}</code>
              </dd>
              <dt>Authorization server</dt>
              <dd>
                <code>{process.env.FOURM_URL ?? "http://localhost:8000"}</code>
              </dd>
              <dt>Required scope</dt>
              <dd>
                <code>artbin:admin</code>
              </dd>
              <dt>Protected resource</dt>
              <dd>
                <code>{endpoint}</code>
              </dd>
            </dl>
          </section>
          <section>
            <h2>Available tools</h2>
            <ul>
              {mcpTools.map((tool) => (
                <li key={tool.name}>
                  <code>{tool.name}</code> — {tool.description}
                </li>
              ))}
            </ul>
          </section>
        </AdminPage>,
      );
    },

    async users(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const allUsers = await db
        .select({
          id: users.id,
          username: users.username,
          isAdmin: users.isAdmin,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt));

      return context.render(
        <AdminPage user={context.user} active="users" title="Users">
          {allUsers.length ? (
            <DataTable label="Users">
              <thead>
                <TableHeaderRow>
                  <TableHeaderCell>Username</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Joined</TableHeaderCell>
                </TableHeaderRow>
              </thead>
              <tbody>
                {allUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>@{user.username}</TableCell>
                    <TableCell>
                      <Badge tone={user.isAdmin ? "info" : "neutral"}>
                        {user.isAdmin ? "Admin" : "User"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.createdAt
                        ? new Date(user.createdAt).toLocaleString()
                        : "Unknown"}
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState title="No users yet" />
          )}
        </AdminPage>,
      );
    },
  },
});
