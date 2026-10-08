import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { css } from "remix/component";

import { operationCatalog } from "../../../operations/catalog.ts";
import { operationErrorResponse } from "../../../operations/errors.ts";

import { requireAdmin } from "../../../middleware/auth.ts";
import { routes } from "../../../routes.ts";
import { AdminPage } from "../../../ui/admin-page.tsx";
import { AutoRefresh } from "../../../ui/public/auto-refresh.tsx";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ProgressBar,
  TableCell,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  type Tone,
} from "../../../ui/primitives.tsx";
import { dangerTextStyle, mutedTextStyle } from "../../../ui/styles.ts";

const refreshNoteStyle = css({ fontSize: "0.875rem", margin: "0 0 0.5rem" });
const smallCellStyle = css({ fontSize: "0.75rem" });
const progressCellStyle = css({ fontSize: "0.75rem", maxWidth: "260px" });
const actionsStyle = css({ display: "flex", gap: "0.25rem" });

export default createController(routes.admin.jobs, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const { jobs } = await operationCatalog.jobsList.execute(
        { user: context.user, channel: "admin" },
        { limit: 100 },
      );
      const active = jobs.some(
        (job) => job.status === "running" || job.status === "pending",
      );

      return context.render(
        <AdminPage user={context.user} active="jobs" title="Jobs">
          <AutoRefresh active={active} />
          {active ? (
            <p mix={[refreshNoteStyle, mutedTextStyle]}>
              Active jobs refresh every two seconds.
            </p>
          ) : null}
          {jobs.length ? (
            <JobsTable jobs={jobs} />
          ) : (
            <EmptyState
              title="No jobs found"
              description="Imports and maintenance tasks will appear here."
            />
          )}
        </AdminPage>,
      );
    },

    async action(context) {
      const form = await context.request.formData();
      const intent = form.get("intent");
      const jobId = form.get("jobId");
      if (typeof jobId !== "string" || !jobId) {
        return new Response("Missing job ID", { status: 400 });
      }

      if (intent !== "delete" && intent !== "cancel" && intent !== "reset") {
        return new Response("Unknown job action", { status: 400 });
      }
      if (!context.user) return redirect(routes.login.href(), 303);
      try {
        await operationCatalog.jobManage.execute(
          { user: context.user, channel: "admin" },
          { jobId, operation: intent, confirm: true },
        );
      } catch (error) {
        return operationErrorResponse(error);
      }
      return redirect(routes.admin.jobs.index.href(), 303);
    },
  },
});

type AdminJob = Awaited<
  ReturnType<(typeof operationCatalog)["jobsList"]["execute"]>
>["jobs"][number];

function JobsTable(handle: { props: { jobs: AdminJob[] } }) {
  return () => (
    <DataTable label="Background jobs">
      <thead>
        <TableHeaderRow>
          <TableHeaderCell>ID</TableHeaderCell>
          <TableHeaderCell>Type</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Progress</TableHeaderCell>
          <TableHeaderCell>Created</TableHeaderCell>
          <TableHeaderCell>Actions</TableHeaderCell>
        </TableHeaderRow>
      </thead>
      <tbody>
        {handle.props.jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell>
              <code mix={smallCellStyle}>{job.id.slice(0, 8)}...</code>
            </TableCell>
            <TableCell>{job.type}</TableCell>
            <TableCell>
              <Badge tone={statusTone(job.status, job.isStuck)}>
                {job.isStuck ? "stuck" : job.status}
              </Badge>
            </TableCell>
            <TableCell>
              <div mix={progressCellStyle}>
                {job.status === "running" ? (
                  <ProgressBar
                    value={job.progress ?? 0}
                    label={job.progressMessage ?? "Running"}
                  />
                ) : job.status === "failed" ? (
                  <span mix={dangerTextStyle} title={job.error ?? undefined}>
                    {job.error?.slice(0, 60) ?? "Failed"}
                  </span>
                ) : (
                  job.status
                )}
              </div>
            </TableCell>
            <TableCell>
              <span mix={smallCellStyle}>{formatDate(job.createdAt)}</span>
            </TableCell>
            <TableCell>
              <div mix={actionsStyle}>
                {job.status === "pending" ? (
                  <JobForm jobId={job.id} intent="cancel" />
                ) : null}
                {job.status === "running" && job.isStuck ? (
                  <JobForm jobId={job.id} intent="reset" />
                ) : null}
                {job.status !== "running" || job.isStuck ? (
                  <JobForm jobId={job.id} intent="delete" danger />
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </tbody>
    </DataTable>
  );
}

function JobForm(handle: {
  props: { jobId: string; intent: string; danger?: boolean };
}) {
  return () => (
    <form method="post" action={routes.admin.jobs.action.href()}>
      <input type="hidden" name="jobId" value={handle.props.jobId} />
      <Button
        type="submit"
        name="intent"
        value={handle.props.intent}
        size="small"
        variant={handle.props.danger ? "danger" : "default"}
      >
        {handle.props.intent[0]!.toUpperCase() + handle.props.intent.slice(1)}
      </Button>
    </form>
  );
}

function statusTone(status: string, stuck: boolean): Tone {
  if (stuck || status === "failed") return "danger";
  if (status === "completed") return "success";
  if (status === "running") return "warning";
  if (status === "cancelled") return "neutral";
  return "info";
}

function formatDate(value: Date | string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}
