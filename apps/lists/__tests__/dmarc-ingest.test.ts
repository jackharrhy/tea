import { describe, expect, test } from "bun:test";
import { simpleParser } from "mailparser";
import { createTestDb } from "./helpers";
import { schema } from "../src/db";
import { ingestDmarcEmail } from "../src/services/dmarc-ingest";

const xml = `<feedback>
<report_metadata><org_name>Receiver</org_name><email>reports@receiver.test</email><report_id>duplicate-id</report_id><date_range><begin>1787702400</begin><end>1787788800</end></date_range></report_metadata>
<policy_published><domain>jackharrhy.dev</domain><p>quarantine</p></policy_published>
<record><row><source_ip>192.0.2.1</source_ip><count>7</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>fail</spf></policy_evaluated></row><identifiers><header_from>jackharrhy.dev</header_from></identifiers><auth_results><dkim><domain>jackharrhy.dev</domain><result>pass</result></dkim></auth_results></record>
</feedback>`;

async function reportEmail(content = xml) {
  return simpleParser(
    [
      "From: reports@receiver.test",
      "To: reports@dmarc.jackharrhy.dev",
      "Subject: DMARC report",
      "MIME-Version: 1.0",
      'Content-Type: application/xml; name="report.xml"',
      "Content-Disposition: attachment; filename=report.xml",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(content).toString("base64"),
    ].join("\r\n"),
  );
}

describe("DMARC ingestion", () => {
  test("stores normalized reports and deduplicates report deliveries", async () => {
    const db = createTestDb();
    const email = await reportEmail();
    const first = ingestDmarcEmail(
      db,
      { messageId: "ses-1", timestamp: new Date().toISOString() },
      email,
      "dmarc/1.eml",
    );
    const second = ingestDmarcEmail(
      db,
      { messageId: "ses-2", timestamp: new Date().toISOString() },
      email,
      "dmarc/2.eml",
    );

    expect(first.status).toBe("parsed");
    expect(second.status).toBe("parsed");
    expect(db.select().from(schema.dmarcReports).all()).toHaveLength(1);
    expect(db.select().from(schema.dmarcReportRecords).all()).toHaveLength(1);
    expect(db.select().from(schema.dmarcIngestions).all()).toHaveLength(2);
    expect(db.select().from(schema.dmarcReports).get()?.messageCount).toBe(7);
  });

  test("records malformed reports as terminal rejections", async () => {
    const db = createTestDb();
    const result = ingestDmarcEmail(
      db,
      { messageId: "ses-bad", timestamp: new Date().toISOString() },
      await reportEmail("<hello />"),
      "dmarc/bad.eml",
    );
    expect(result.status).toBe("rejected");
    expect(result.error).toContain("not a DMARC");
    expect(db.select().from(schema.dmarcReports).all()).toHaveLength(0);
  });
});
