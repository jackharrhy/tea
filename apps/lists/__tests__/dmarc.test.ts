import { describe, expect, test } from "bun:test";
import { gzipSync, zipSync } from "fflate";
import {
  DmarcParseError,
  findDmarcAttachment,
  parseDmarcAttachment,
} from "../src/services/dmarc";

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feedback>
  <report_metadata>
    <org_name>Example Receiver</org_name>
    <email>dmarc@example.net</email>
    <report_id>report-123</report_id>
    <date_range><begin>1787702400</begin><end>1787788800</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>jackharrhy.dev</domain><adkim>r</adkim><aspf>r</aspf>
    <p>quarantine</p><sp>quarantine</sp><np>reject</np>
    <testing>n</testing><discovery_method>treewalk</discovery_method>
  </policy_published>
  <record>
    <row>
      <source_ip>192.0.2.10</source_ip><count>42</count>
      <policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated>
    </row>
    <identifiers><envelope_from>mail.jackharrhy.dev</envelope_from><header_from>jackharrhy.dev</header_from></identifiers>
    <auth_results>
      <dkim><domain>jackharrhy.dev</domain><selector>ses</selector><result>pass</result></dkim>
      <spf><domain>mail.jackharrhy.dev</domain><scope>mfrom</scope><result>pass</result></spf>
    </auth_results>
  </record>
</feedback>`;

describe("DMARC aggregate parser", () => {
  test("parses RFC 9990 fields and normalized records", () => {
    const report = parseDmarcAttachment({
      content: Buffer.from(xml),
      filename: "report.xml",
    });
    expect(report.reportId).toBe("report-123");
    expect(report.domain).toBe("jackharrhy.dev");
    expect(report.nonexistentSubdomainPolicy).toBe("reject");
    expect(report.discoveryMethod).toBe("treewalk");
    expect(report.records[0]).toMatchObject({
      sourceIp: "192.0.2.10",
      count: 42,
      dkimResult: "pass",
      spfResult: "pass",
    });
    expect(report.records[0]!.authResults.spf[0]!.domain).toBe(
      "mail.jackharrhy.dev",
    );
  });

  test("parses gzip and ZIP reports by magic bytes", () => {
    expect(
      parseDmarcAttachment({
        content: gzipSync(Buffer.from(xml)),
        filename: "wrong.bin",
      }).reportId,
    ).toBe("report-123");
    const zipped = zipSync({ "nested/report.xml": Buffer.from(xml) });
    expect(
      parseDmarcAttachment({ content: zipped, filename: "report.zip" })
        .records[0]!.count,
    ).toBe(42);
  });

  test("rejects entity declarations and non-DMARC XML", () => {
    expect(() =>
      parseDmarcAttachment({
        content: Buffer.from(
          "<!DOCTYPE x [<!ENTITY y SYSTEM 'file:///etc/passwd'>]><feedback>&y;</feedback>",
        ),
      }),
    ).toThrow(DmarcParseError);
    expect(() =>
      parseDmarcAttachment({ content: Buffer.from("<not-a-report />") }),
    ).toThrow("not a DMARC aggregate report");
    expect(() =>
      parseDmarcAttachment({
        content: Buffer.from("<feedback><broken></feedback>"),
      }),
    ).toThrow("Invalid DMARC XML");
  });

  test("finds report attachments without trusting only the filename", () => {
    const attachment = {
      content: gzipSync(Buffer.from(xml)),
      filename: "opaque.dat",
      contentType: "application/octet-stream",
    };
    expect(findDmarcAttachment([attachment])).toBe(attachment);
    expect(() =>
      findDmarcAttachment([
        { content: Buffer.from("hello"), filename: "notes.txt" },
      ]),
    ).toThrow("no DMARC");
  });
});
