import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, desc, eq, sql } from "drizzle-orm";
import { css, type Handle } from "remix/component";
import { createController } from "remix/router";

import type { Config } from "../src/config.ts";
import { schema, type Db } from "../src/db/index.ts";
import { s3ClientConfig } from "../src/services/aws.ts";
import { AdminDocument, type Viewer } from "./admin.tsx";
import { routes } from "./routes.ts";

type User = Pick<
  typeof schema.users.$inferSelect,
  "id" | "role" | "name" | "email"
>;
type Report = typeof schema.dmarcReports.$inferSelect;
type RecordRow = typeof schema.dmarcReportRecords.$inferSelect;
type Rejection = typeof schema.dmarcIngestions.$inferSelect;

const heading = css({ fontSize: "24px", fontWeight: 650, margin: "0 0 20px" });
const section = css({
  fontSize: "18px",
  fontWeight: 600,
  margin: "28px 0 12px",
});
const muted = css({ color: "#6b7280", fontSize: "14px" });
const link = css({ color: "#1d4ed8", textDecoration: "none" });
const table = css({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
});
const cell = css({
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  textAlign: "left",
});
const stats = css({ display: "flex", flexWrap: "wrap", gap: "16px" });
const stat = css({
  flex: "1 1 160px",
  padding: "16px",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  backgroundColor: "#fff",
});
const statValue = css({ display: "block", fontSize: "24px", fontWeight: 600 });
const statLabel = css({ display: "block", color: "#6b7280", fontSize: "13px" });
const filter = css({
  display: "flex",
  alignItems: "center",
  gap: "10px",
  marginBottom: "20px",
});
const select = css({
  padding: "6px 10px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  backgroundColor: "#fff",
});
const details = css({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "16px",
  padding: "16px",
  backgroundColor: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
});

function percent(part: number, total: number) {
  return total ? `${((part / total) * 100).toFixed(1)}%` : "—";
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleString("en-US") : "—";
}

function forbidden() {
  return new Response("Forbidden", { status: 403 });
}

function DmarcIndex(
  handle: Handle<{
    viewer: Viewer;
    domain: string;
    domains: string[];
    reports: Report[];
    totals: { total: number; passing: number; dkim: number; spf: number };
    sources: Array<{ sourceIp: string; count: number; passing: number }>;
    rejected: Rejection[];
  }>,
) {
  return () => {
    const { viewer, domain, domains, reports, totals, sources, rejected } =
      handle.props;
    return (
      <AdminDocument title="DMARC" activeHref="/admin/dmarc" viewer={viewer}>
        <h1 mix={heading}>DMARC</h1>
        <p mix={muted}>
          Aggregate authentication reports received through SES.
        </p>
        <form mix={filter} method="get" action="/admin/dmarc">
          <label for="domain">Domain</label>
          <select mix={select} id="domain" name="domain" defaultValue={domain}>
            <option value="">All domains</option>
            {domains.map((item) => (
              <option value={item}>{item}</option>
            ))}
          </select>
          <button type="submit">Filter</button>
        </form>
        <div mix={stats}>
          {(
            [
              ["Messages", String(totals.total)],
              ["DMARC pass", percent(totals.passing, totals.total)],
              ["DKIM pass", percent(totals.dkim, totals.total)],
              ["SPF pass", percent(totals.spf, totals.total)],
            ] as Array<[string, string]>
          ).map(([label, value]) => (
            <div mix={stat}>
              <strong mix={statValue}>{value}</strong>
              <span mix={statLabel}>{label}</span>
            </div>
          ))}
        </div>
        <h2 mix={section}>Recent reports</h2>
        {reports.length ? (
          <table mix={table}>
            <thead>
              <tr>
                <th mix={cell}>Period</th>
                <th mix={cell}>Domain</th>
                <th mix={cell}>Reporter</th>
                <th mix={cell}>Messages</th>
                <th mix={cell}>Policy</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr>
                  <td mix={cell}>
                    <a mix={link} href={`/admin/dmarc/${report.id}`}>
                      {date(report.dateEnd)}
                    </a>
                  </td>
                  <td mix={cell}>{report.domain}</td>
                  <td mix={cell}>{report.reporterOrg}</td>
                  <td mix={cell}>{report.messageCount}</td>
                  <td mix={cell}>{report.policy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p mix={muted}>No DMARC reports received yet.</p>
        )}
        <h2 mix={section}>Top sending sources</h2>
        {sources.length ? (
          <table mix={table}>
            <thead>
              <tr>
                <th mix={cell}>Source IP</th>
                <th mix={cell}>Messages</th>
                <th mix={cell}>Pass</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr>
                  <td mix={cell}>{source.sourceIp}</td>
                  <td mix={cell}>{source.count}</td>
                  <td mix={cell}>{percent(source.passing, source.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p mix={muted}>No source data yet.</p>
        )}
        <h2 mix={section}>Rejected reports</h2>
        {rejected.length ? (
          rejected.map((item) => (
            <p>
              {item.error} <span mix={muted}>{date(item.processedAt)}</span>
            </p>
          ))
        ) : (
          <p mix={muted}>No rejected reports.</p>
        )}
      </AdminDocument>
    );
  };
}

function DmarcDetail(
  handle: Handle<{
    viewer: Viewer;
    report: Report;
    records: RecordRow[];
    hasRaw: boolean;
  }>,
) {
  return () => {
    const { viewer, report, records, hasRaw } = handle.props;
    return (
      <AdminDocument
        title={`DMARC ${report.domain}`}
        activeHref="/admin/dmarc"
        viewer={viewer}
      >
        <p>
          <a mix={link} href="/admin/dmarc">
            ← DMARC reports
          </a>
        </p>
        <h1 mix={heading}>{report.domain}</h1>
        <p mix={muted}>
          {report.reporterOrg} · {report.externalReportId}
        </p>
        {hasRaw ? (
          <p>
            <a mix={link} href={`/admin/dmarc/${report.id}/raw`}>
              Download raw email
            </a>
          </p>
        ) : null}
        <dl mix={details}>
          <div>
            <dt>Period</dt>
            <dd>
              {date(report.dateBegin)} – {date(report.dateEnd)}
            </dd>
          </div>
          <div>
            <dt>Messages</dt>
            <dd>{report.messageCount}</dd>
          </div>
          <div>
            <dt>Policy</dt>
            <dd>
              p={report.policy}; sp={report.subdomainPolicy ?? "default"}; np=
              {report.nonexistentSubdomainPolicy ?? "default"}
            </dd>
          </div>
          <div>
            <dt>Alignment</dt>
            <dd>
              DKIM {report.adkim}; SPF {report.aspf}
            </dd>
          </div>
        </dl>
        <h2 mix={section}>Source records</h2>
        <table mix={table}>
          <thead>
            <tr>
              <th mix={cell}>Source IP</th>
              <th mix={cell}>Count</th>
              <th mix={cell}>Header From</th>
              <th mix={cell}>Disposition</th>
              <th mix={cell}>DKIM</th>
              <th mix={cell}>SPF</th>
              <th mix={cell}>DMARC</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr>
                <td mix={cell}>{record.sourceIp}</td>
                <td mix={cell}>{record.count}</td>
                <td mix={cell}>{record.headerFrom}</td>
                <td mix={cell}>{record.disposition}</td>
                <td mix={cell}>{record.dkimResult}</td>
                <td mix={cell}>{record.spfResult}</td>
                <td mix={cell}>{record.dmarcPass ? "pass" : "fail"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminDocument>
    );
  };
}

export function createAdminDmarcController(db: Db, config: Config, user: User) {
  const viewer: Viewer = {
    name: user.name ?? user.email,
    isAdmin: user.role !== "member",
  };
  return createController(routes.admin.dmarc, {
    actions: {
      index(context) {
        if (!viewer.isAdmin) return forbidden();
        const domain =
          new URL(context.request.url).searchParams.get("domain") ?? "";
        const whereDomain = domain
          ? eq(schema.dmarcReports.domain, domain)
          : undefined;
        const reports = db
          .select()
          .from(schema.dmarcReports)
          .where(whereDomain)
          .orderBy(desc(schema.dmarcReports.dateEnd))
          .limit(50)
          .all();
        const domains = db
          .selectDistinct({ domain: schema.dmarcReports.domain })
          .from(schema.dmarcReports)
          .orderBy(schema.dmarcReports.domain)
          .all()
          .map((row) => row.domain);
        const totals = db
          .select({
            total: sql<number>`coalesce(sum(${schema.dmarcReportRecords.count}), 0)`,
            passing: sql<number>`coalesce(sum(case when ${schema.dmarcReportRecords.dmarcPass} = 1 then ${schema.dmarcReportRecords.count} else 0 end), 0)`,
            dkim: sql<number>`coalesce(sum(case when ${schema.dmarcReportRecords.dkimResult} = 'pass' then ${schema.dmarcReportRecords.count} else 0 end), 0)`,
            spf: sql<number>`coalesce(sum(case when ${schema.dmarcReportRecords.spfResult} = 'pass' then ${schema.dmarcReportRecords.count} else 0 end), 0)`,
          })
          .from(schema.dmarcReportRecords)
          .innerJoin(
            schema.dmarcReports,
            eq(schema.dmarcReportRecords.reportId, schema.dmarcReports.id),
          )
          .where(whereDomain)
          .get()!;
        const sources = db
          .select({
            sourceIp: schema.dmarcReportRecords.sourceIp,
            count: sql<number>`sum(${schema.dmarcReportRecords.count})`,
            passing: sql<number>`sum(case when ${schema.dmarcReportRecords.dmarcPass} = 1 then ${schema.dmarcReportRecords.count} else 0 end)`,
          })
          .from(schema.dmarcReportRecords)
          .innerJoin(
            schema.dmarcReports,
            eq(schema.dmarcReportRecords.reportId, schema.dmarcReports.id),
          )
          .where(whereDomain)
          .groupBy(schema.dmarcReportRecords.sourceIp)
          .orderBy(desc(sql`sum(${schema.dmarcReportRecords.count})`))
          .limit(10)
          .all();
        const rejected = db
          .select()
          .from(schema.dmarcIngestions)
          .where(eq(schema.dmarcIngestions.status, "rejected"))
          .orderBy(desc(schema.dmarcIngestions.processedAt))
          .limit(10)
          .all();
        return context.render(
          <DmarcIndex
            viewer={viewer}
            domain={domain}
            domains={domains}
            reports={reports}
            totals={totals}
            sources={sources}
            rejected={rejected}
          />,
        );
      },
      show(context) {
        if (!viewer.isAdmin) return forbidden();
        const id = Number(context.params.id);
        if (!Number.isSafeInteger(id) || id <= 0)
          return new Response("Bad Request", { status: 400 });
        const report = db
          .select()
          .from(schema.dmarcReports)
          .where(eq(schema.dmarcReports.id, id))
          .get();
        if (!report) return new Response("Not Found", { status: 404 });
        const records = db
          .select()
          .from(schema.dmarcReportRecords)
          .where(eq(schema.dmarcReportRecords.reportId, id))
          .orderBy(desc(schema.dmarcReportRecords.count))
          .all();
        const hasRaw = Boolean(
          db
            .select({ id: schema.dmarcIngestions.id })
            .from(schema.dmarcIngestions)
            .where(
              and(
                eq(schema.dmarcIngestions.reportId, id),
                eq(schema.dmarcIngestions.status, "parsed"),
              ),
            )
            .get(),
        );
        return context.render(
          <DmarcDetail
            viewer={viewer}
            report={report}
            records={records}
            hasRaw={hasRaw}
          />,
        );
      },
      async raw(context) {
        if (!viewer.isAdmin) return forbidden();
        const id = Number(context.params.id);
        if (!Number.isSafeInteger(id) || id <= 0)
          return new Response("Bad Request", { status: 400 });
        const ingestion = db
          .select()
          .from(schema.dmarcIngestions)
          .where(
            and(
              eq(schema.dmarcIngestions.reportId, id),
              eq(schema.dmarcIngestions.status, "parsed"),
            ),
          )
          .get();
        if (!ingestion) return new Response("Not Found", { status: 404 });
        const s3 = new S3Client(s3ClientConfig(config));
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: config.s3Bucket,
            Key: ingestion.rawS3Key,
          }),
          { expiresIn: 300 },
        );
        return new Response(null, { status: 302, headers: { Location: url } });
      },
    },
  });
}
