import { Gunzip, Unzip, UnzipInflate } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_XML_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 20;

export class DmarcParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DmarcParseError";
  }
}

export type DmarcAttachment = {
  content: Uint8Array;
  filename?: string | null;
  contentType?: string | null;
};

type DmarcRecord = {
  sourceIp: string;
  count: number;
  disposition: string;
  dkimResult: string;
  spfResult: string;
  headerFrom: string;
  envelopeFrom: string | null;
  envelopeTo: string | null;
  overrideReasons: Array<{ type: string; comment?: string }>;
  authResults: {
    dkim: Array<{
      domain: string;
      selector?: string;
      result: string;
      humanResult?: string;
    }>;
    spf: Array<{
      domain: string;
      scope?: string;
      result: string;
      humanResult?: string;
    }>;
  };
};

export type DmarcReport = {
  reporterOrg: string;
  reporterEmail: string | null;
  reportId: string;
  dateBegin: string;
  dateEnd: string;
  domain: string;
  policy: string;
  subdomainPolicy: string | null;
  nonexistentSubdomainPolicy: string | null;
  adkim: string;
  aspf: string;
  testing: string | null;
  discoveryMethod: string | null;
  records: DmarcRecord[];
};

function boundedChunks() {
  const chunks: Uint8Array[] = [];
  let size = 0;
  return {
    add(chunk: Uint8Array) {
      size += chunk.length;
      if (size > MAX_XML_BYTES)
        throw new DmarcParseError("Decompressed DMARC report exceeds 10 MiB");
      chunks.push(chunk);
    },
    bytes() {
      const output = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return output;
    },
  };
}

function gunzipBounded(input: Uint8Array): Uint8Array {
  const output = boundedChunks();
  let failure: Error | null = null;
  const stream = new Gunzip((chunk, final) => {
    try {
      output.add(chunk);
    } catch (error) {
      failure = error as Error;
    }
    if (final && failure) throw failure;
  });
  try {
    stream.push(input, true);
  } catch (error) {
    if (error instanceof DmarcParseError) throw error;
    throw new DmarcParseError(
      `Invalid gzip DMARC report: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (failure) throw failure;
  return output.bytes();
}

function unzipXmlBounded(input: Uint8Array): Uint8Array {
  let entries = 0;
  let selected = false;
  let output: ReturnType<typeof boundedChunks> | null = null;
  let failure: Error | null = null;
  const unzip = new Unzip((file) => {
    entries++;
    if (entries > MAX_ZIP_ENTRIES) {
      failure = new DmarcParseError("DMARC ZIP contains too many entries");
      return;
    }
    if (selected || !file.name.toLowerCase().endsWith(".xml")) return;
    selected = true;
    output = boundedChunks();
    file.ondata = (error, chunk) => {
      if (error) {
        failure = new DmarcParseError(
          `Invalid DMARC ZIP entry: ${error.message}`,
        );
        return;
      }
      try {
        output!.add(chunk);
      } catch (caught) {
        failure = caught as Error;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    unzip.push(input, true);
  } catch (error) {
    if (error instanceof DmarcParseError) throw error;
    throw new DmarcParseError(
      `Invalid ZIP DMARC report: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (failure) throw failure;
  if (!selected || !output)
    throw new DmarcParseError("DMARC ZIP contains no XML report");
  return (output as ReturnType<typeof boundedChunks>).bytes();
}

function extractXml(attachment: DmarcAttachment): Uint8Array {
  const input = attachment.content;
  if (!input.length) throw new DmarcParseError("DMARC attachment is empty");
  if (input.length > MAX_COMPRESSED_BYTES)
    throw new DmarcParseError("DMARC attachment exceeds 2 MiB");

  if (input[0] === 0x1f && input[1] === 0x8b) return gunzipBounded(input);
  if (input[0] === 0x50 && input[1] === 0x4b) return unzipXmlBounded(input);
  if (input.length > MAX_XML_BYTES)
    throw new DmarcParseError("DMARC XML exceeds 10 MiB");
  return input;
}

function arrayOf<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new DmarcParseError(`DMARC report is missing ${field}`);
  }
  const result = String(value).trim();
  if (!result) throw new DmarcParseError(`DMARC report is missing ${field}`);
  return result;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
}

function timestamp(value: unknown, field: string): string {
  const seconds = Number(requiredString(value, field));
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new DmarcParseError(`DMARC ${field} is invalid`);
  return new Date(seconds * 1000).toISOString();
}

function normalizedResult(value: unknown): string {
  return optionalString(value)?.toLowerCase() ?? "unknown";
}

export function parseDmarcAttachment(attachment: DmarcAttachment): DmarcReport {
  const bytes = extractXml(attachment);
  const xml = new TextDecoder().decode(bytes).trim();
  if (!xml.startsWith("<") || !xml.includes("<feedback")) {
    throw new DmarcParseError("Attachment is not a DMARC aggregate report");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new DmarcParseError(
      "DMARC XML declarations and entities are not allowed",
    );

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new DmarcParseError(`Invalid DMARC XML: ${validation.err.msg}`);
  }

  let parsed: any;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      trimValues: true,
      processEntities: false,
    }).parse(xml);
  } catch (error) {
    throw new DmarcParseError(
      `Invalid DMARC XML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const feedback = parsed?.feedback;
  if (!feedback || typeof feedback !== "object")
    throw new DmarcParseError("DMARC report has no feedback element");
  const metadata = feedback.report_metadata;
  const range = metadata?.date_range;
  const policy = feedback.policy_published;
  if (!metadata || !range || !policy)
    throw new DmarcParseError("DMARC report metadata or policy is missing");

  const records = arrayOf<any>(feedback.record).map(
    (record, index): DmarcRecord => {
      const row = record?.row;
      const identifiers = record?.identifiers ?? {};
      const evaluated = row?.policy_evaluated ?? {};
      if (!row)
        throw new DmarcParseError(`DMARC record ${index + 1} has no row`);
      const count = Number(
        requiredString(row.count, `record ${index + 1} count`),
      );
      if (!Number.isSafeInteger(count) || count < 0)
        throw new DmarcParseError(`DMARC record ${index + 1} count is invalid`);

      return {
        sourceIp: requiredString(
          row.source_ip,
          `record ${index + 1} source IP`,
        ),
        count,
        disposition: normalizedResult(evaluated.disposition),
        dkimResult: normalizedResult(evaluated.dkim),
        spfResult: normalizedResult(evaluated.spf),
        headerFrom: requiredString(
          identifiers.header_from,
          `record ${index + 1} header_from`,
        ),
        envelopeFrom: optionalString(identifiers.envelope_from),
        envelopeTo: optionalString(identifiers.envelope_to),
        overrideReasons: arrayOf<any>(evaluated.reason).map((reason) => ({
          type: requiredString(reason?.type, "policy override type"),
          ...(optionalString(reason?.comment)
            ? { comment: optionalString(reason.comment)! }
            : {}),
        })),
        authResults: {
          dkim: arrayOf<any>(record?.auth_results?.dkim).map((result) => ({
            domain: requiredString(result?.domain, "DKIM auth domain"),
            ...(optionalString(result?.selector)
              ? { selector: optionalString(result.selector)! }
              : {}),
            result: normalizedResult(result?.result),
            ...(optionalString(result?.human_result)
              ? { humanResult: optionalString(result.human_result)! }
              : {}),
          })),
          spf: arrayOf<any>(record?.auth_results?.spf).map((result) => ({
            domain: requiredString(result?.domain, "SPF auth domain"),
            ...(optionalString(result?.scope)
              ? { scope: optionalString(result.scope)! }
              : {}),
            result: normalizedResult(result?.result),
            ...(optionalString(result?.human_result)
              ? { humanResult: optionalString(result.human_result)! }
              : {}),
          })),
        },
      };
    },
  );

  if (!records.length)
    throw new DmarcParseError("DMARC report contains no records");

  return {
    reporterOrg: requiredString(metadata.org_name, "reporter organization"),
    reporterEmail: optionalString(metadata.email),
    reportId: requiredString(metadata.report_id, "report ID"),
    dateBegin: timestamp(range.begin, "date range begin"),
    dateEnd: timestamp(range.end, "date range end"),
    domain: requiredString(
      policy.domain,
      "published policy domain",
    ).toLowerCase(),
    policy: normalizedResult(policy.p),
    subdomainPolicy: optionalString(policy.sp)?.toLowerCase() ?? null,
    nonexistentSubdomainPolicy:
      optionalString(policy.np)?.toLowerCase() ?? null,
    adkim: optionalString(policy.adkim)?.toLowerCase() ?? "r",
    aspf: optionalString(policy.aspf)?.toLowerCase() ?? "r",
    testing: optionalString(policy.testing ?? policy.t)?.toLowerCase() ?? null,
    discoveryMethod:
      optionalString(policy.discovery_method)?.toLowerCase() ?? null,
    records,
  };
}

export function findDmarcAttachment(
  attachments: DmarcAttachment[],
): DmarcAttachment {
  const candidate = attachments.find((attachment) => {
    const name = attachment.filename?.toLowerCase() ?? "";
    const type = attachment.contentType?.toLowerCase() ?? "";
    const bytes = attachment.content;
    return (
      name.endsWith(".xml") ||
      name.endsWith(".xml.gz") ||
      name.endsWith(".gz") ||
      name.endsWith(".zip") ||
      type.includes("xml") ||
      type.includes("gzip") ||
      type.includes("zip") ||
      (bytes[0] === 0x1f && bytes[1] === 0x8b) ||
      (bytes[0] === 0x50 && bytes[1] === 0x4b)
    );
  });
  if (!candidate)
    throw new DmarcParseError(
      "Email contains no DMARC XML, gzip, or ZIP attachment",
    );
  return candidate;
}
