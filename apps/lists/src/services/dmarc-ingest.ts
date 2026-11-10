import { eq } from "drizzle-orm";
import type { ParsedMail } from "mailparser";
import type { Db } from "../db";
import { schema } from "../db";
import {
  DmarcParseError,
  findDmarcAttachment,
  parseDmarcAttachment,
} from "./dmarc";
import { logEvent } from "./events";

export type DmarcInboundPayload = {
  messageId: string;
  timestamp: string;
};

export function ingestDmarcEmail(
  db: Db,
  payload: DmarcInboundPayload,
  parsedEmail: ParsedMail,
  s3Key: string,
) {
  const existing = db
    .select()
    .from(schema.dmarcIngestions)
    .where(eq(schema.dmarcIngestions.sesMessageId, payload.messageId))
    .get();
  if (existing?.status === "parsed" || existing?.status === "rejected")
    return existing;

  const ingestion =
    existing ??
    db
      .insert(schema.dmarcIngestions)
      .values({
        sesMessageId: payload.messageId,
        rawS3Key: s3Key,
        status: "processing",
        receivedAt: payload.timestamp,
      })
      .returning()
      .get();

  try {
    const attachment = findDmarcAttachment(
      parsedEmail.attachments.map((item) => ({
        content: item.content,
        filename: item.filename,
        contentType: item.contentType,
      })),
    );
    const report = parseDmarcAttachment(attachment);
    const reportKey = JSON.stringify([
      report.reporterOrg.toLowerCase(),
      report.reportId,
      report.domain,
      report.dateBegin,
      report.dateEnd,
    ]);
    const messageCount = report.records.reduce(
      (total, record) => total + record.count,
      0,
    );

    const savedReport = db.transaction((tx) => {
      let stored: typeof schema.dmarcReports.$inferSelect | undefined = tx
        .insert(schema.dmarcReports)
        .values({
          reportKey,
          reporterOrg: report.reporterOrg,
          reporterEmail: report.reporterEmail,
          externalReportId: report.reportId,
          domain: report.domain,
          dateBegin: report.dateBegin,
          dateEnd: report.dateEnd,
          policy: report.policy,
          subdomainPolicy: report.subdomainPolicy,
          nonexistentSubdomainPolicy: report.nonexistentSubdomainPolicy,
          adkim: report.adkim,
          aspf: report.aspf,
          testing: report.testing,
          discoveryMethod: report.discoveryMethod,
          messageCount,
        })
        .onConflictDoNothing({ target: schema.dmarcReports.reportKey })
        .returning()
        .get();

      if (stored) {
        tx.insert(schema.dmarcReportRecords)
          .values(
            report.records.map((record) => ({
              reportId: stored!.id,
              sourceIp: record.sourceIp,
              count: record.count,
              disposition: record.disposition,
              dkimResult: record.dkimResult,
              spfResult: record.spfResult,
              dmarcPass:
                record.dkimResult === "pass" || record.spfResult === "pass",
              headerFrom: record.headerFrom,
              envelopeFrom: record.envelopeFrom,
              envelopeTo: record.envelopeTo,
              overrideReasons: JSON.stringify(record.overrideReasons),
              authResults: JSON.stringify(record.authResults),
            })),
          )
          .run();
      } else {
        stored = tx
          .select()
          .from(schema.dmarcReports)
          .where(eq(schema.dmarcReports.reportKey, reportKey))
          .get();
      }

      if (!stored) throw new Error("DMARC report could not be stored");
      tx.update(schema.dmarcIngestions)
        .set({
          status: "parsed",
          reportId: stored.id,
          error: null,
          processedAt: new Date().toISOString(),
        })
        .where(eq(schema.dmarcIngestions.id, ingestion.id))
        .run();
      return stored;
    });

    logEvent(db, {
      type: "dmarc.report_received",
      detail: `${report.reporterOrg} reported ${messageCount} messages for ${report.domain}`,
      meta: { reportId: savedReport.id, domain: report.domain, messageCount },
    });
    return db
      .select()
      .from(schema.dmarcIngestions)
      .where(eq(schema.dmarcIngestions.id, ingestion.id))
      .get()!;
  } catch (error) {
    if (!(error instanceof DmarcParseError)) throw error;
    const message = error.message.slice(0, 1000);
    db.update(schema.dmarcIngestions)
      .set({
        status: "rejected",
        error: message,
        processedAt: new Date().toISOString(),
      })
      .where(eq(schema.dmarcIngestions.id, ingestion.id))
      .run();
    logEvent(db, {
      type: "dmarc.report_rejected",
      detail: `Rejected DMARC report ${payload.messageId}: ${message}`,
      meta: { sesMessageId: payload.messageId, s3Key },
    });
    return db
      .select()
      .from(schema.dmarcIngestions)
      .where(eq(schema.dmarcIngestions.id, ingestion.id))
      .get()!;
  }
}
