/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import { and, desc, eq, sql } from "drizzle-orm";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { App } from "../../http";
import type { Db } from "../../db";
import { schema } from "../../db";
import type { Config } from "../../config";
import { s3ClientConfig } from "../../services/aws";
import { AdminLayout, fmtDateTime, type User } from "./layout";
import {
  PageHeader,
  SectionHeading,
  Select,
  Stat,
  StatGrid,
  Table,
  Td,
  Th,
} from "./ui";

function percent(part: number, total: number) {
  return total ? `${((part / total) * 100).toFixed(1)}%` : "—";
}

function isAdmin(user: User) {
  return user.role === "owner" || user.role === "admin";
}

export function mountDmarcRoutes(app: App, db: Db, config: Config) {
  app.get("/dmarc", (c) => {
    const user = c.user as User;
    if (!isAdmin(user)) return c.text("Forbidden", 403);
    const domain = typeof c.query.domain === "string" ? c.query.domain : "";
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
      .all();
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
    const topSources = db
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

    return c.html(
      <AdminLayout title="DMARC" user={user}>
        <PageHeader title="DMARC">
          <form
            method="get"
            action="/admin/dmarc"
            class="flex items-center gap-2"
          >
            <label for="domain" class="text-xs text-gray-500">
              Domain
            </label>
            <Select
              id="domain"
              name="domain"
              class="w-auto py-1.5"
              onchange="this.form.requestSubmit()"
            >
              <option value="">All domains</option>
              {domains.map((item) => (
                <option value={item.domain} selected={item.domain === domain}>
                  {item.domain}
                </option>
              ))}
            </Select>
          </form>
        </PageHeader>
        <p class="-mt-4 mb-5 text-sm text-gray-500">
          Aggregate authentication reports received through SES.
        </p>

        <StatGrid class="sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["Messages", String(totals.total)],
              ["DMARC pass", percent(totals.passing, totals.total)],
              ["DKIM pass", percent(totals.dkim, totals.total)],
              ["SPF pass", percent(totals.spf, totals.total)],
            ] as Array<[string, string]>
          ).map(([label, value]) => (
            <Stat value={value} label={label} />
          ))}
        </StatGrid>

        <SectionHeading>Recent reports</SectionHeading>
        {reports.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Domain</Th>
                <Th>Reporter</Th>
                <Th>Messages</Th>
                <Th>Policy</Th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr>
                  <Td>
                    <a
                      class="text-blue-600 hover:text-blue-800"
                      href={`/admin/dmarc/${report.id}`}
                    >
                      {fmtDateTime(report.dateEnd)}
                    </a>
                  </Td>
                  <Td>{report.domain}</Td>
                  <Td>{report.reporterOrg}</Td>
                  <Td>{report.messageCount}</Td>
                  <Td>{report.policy}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p class="text-sm text-gray-500">No DMARC reports received yet.</p>
        )}

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-7">
          <section>
            <SectionHeading>Top sending sources</SectionHeading>
            {topSources.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Source IP</Th>
                    <Th>Messages</Th>
                    <Th>Pass</Th>
                  </tr>
                </thead>
                <tbody>
                  {topSources.map((source) => (
                    <tr>
                      <Td>{source.sourceIp}</Td>
                      <Td>{source.count}</Td>
                      <Td>{percent(source.passing, source.count)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p class="text-sm text-gray-500">No source data yet.</p>
            )}
          </section>
          <section>
            <SectionHeading>Rejected reports</SectionHeading>
            {rejected.length ? (
              <div class="space-y-2">
                {rejected.map((item) => (
                  <div class="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm">
                    <div class="text-red-700">{item.error}</div>
                    <div class="text-xs text-gray-400 mt-1">
                      {fmtDateTime(item.processedAt)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p class="text-sm text-gray-500">No rejected reports.</p>
            )}
          </section>
        </div>
      </AdminLayout>,
    );
  });

  app.get("/dmarc/:id", (c) => {
    const user = c.user as User;
    if (!isAdmin(user)) return c.text("Forbidden", 403);
    const id = Number(c.params.id);
    const report = db
      .select()
      .from(schema.dmarcReports)
      .where(eq(schema.dmarcReports.id, id))
      .get();
    if (!report) return c.notFound();
    const records = db
      .select()
      .from(schema.dmarcReportRecords)
      .where(eq(schema.dmarcReportRecords.reportId, id))
      .orderBy(desc(schema.dmarcReportRecords.count))
      .all();
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

    return c.html(
      <AdminLayout title={`DMARC ${report.domain}`} user={user}>
        <p class="text-sm mb-3">
          <a href="/admin/dmarc" class="text-blue-600 hover:text-blue-800">
            ← DMARC reports
          </a>
        </p>
        <div class="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 class="text-2xl font-bold m-0">{report.domain}</h1>
            <p class="text-sm text-gray-500 mt-1 mb-0">
              {report.reporterOrg} · {report.externalReportId}
            </p>
          </div>
          {ingestion && (
            <a
              class="text-sm text-blue-600 hover:text-blue-800"
              href={`/admin/dmarc/${report.id}/raw`}
              hx-boost="false"
            >
              Download raw email
            </a>
          )}
        </div>
        <dl class="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white border border-gray-200 rounded p-4 mb-6 text-sm">
          <div>
            <dt class="text-gray-500 text-xs">Period</dt>
            <dd class="m-0">
              {fmtDateTime(report.dateBegin)} – {fmtDateTime(report.dateEnd)}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500 text-xs">Messages</dt>
            <dd class="m-0">{report.messageCount}</dd>
          </div>
          <div>
            <dt class="text-gray-500 text-xs">Policy</dt>
            <dd class="m-0">
              p={report.policy}; sp={report.subdomainPolicy ?? "default"}; np=
              {report.nonexistentSubdomainPolicy ?? "default"}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500 text-xs">Alignment</dt>
            <dd class="m-0">
              DKIM {report.adkim}; SPF {report.aspf}
            </dd>
          </div>
        </dl>
        <Table>
          <thead>
            <tr>
              <Th>Source IP</Th>
              <Th>Count</Th>
              <Th>Header From</Th>
              <Th>Disposition</Th>
              <Th>DKIM</Th>
              <Th>SPF</Th>
              <Th>DMARC</Th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr>
                <Td>{record.sourceIp}</Td>
                <Td>{record.count}</Td>
                <Td>{record.headerFrom}</Td>
                <Td>{record.disposition}</Td>
                <Td>{record.dkimResult}</Td>
                <Td>{record.spfResult}</Td>
                <Td>
                  <span
                    class={record.dmarcPass ? "text-green-700" : "text-red-700"}
                  >
                    {record.dmarcPass ? "pass" : "fail"}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </AdminLayout>,
    );
  });

  app.get("/dmarc/:id/raw", async (c) => {
    const user = c.user as User;
    if (!isAdmin(user)) return c.text("Forbidden", 403);
    const id = Number(c.params.id);
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
    if (!ingestion) return c.notFound();
    const s3 = new S3Client(s3ClientConfig(config));
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: config.s3Bucket,
        Key: ingestion.rawS3Key,
      }),
      {
        expiresIn: 300,
      },
    );
    return c.redirect(url);
  });
}
