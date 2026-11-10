import { expect, test } from "bun:test";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { gzipSync } from "fflate";

const localTest = process.env.LOCAL_E2E === "1" ? test : test.skip;
const appUrl = process.env.LOCAL_APP_URL ?? "http://localhost:8080";
const motoUrl = process.env.LOCAL_MOTO_URL ?? "http://localhost:5000";
const mailpitUrl = process.env.LOCAL_MAILPIT_URL ?? "http://localhost:8025";
const credentials = { accessKeyId: "test", secretAccessKey: "test" };

async function eventually<T>(
  read: () => Promise<T | undefined>,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await Bun.sleep(500);
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

async function login() {
  const response = await fetch(`${appUrl}/admin/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      email: "owner@lists.local",
      password: "local-password",
    }),
  });
  expect(response.status).toBe(302);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function capturedMessage(recipient: string, subject: string) {
  return eventually(async () => {
    const response = await fetch(`${mailpitUrl}/api/v1/messages`);
    if (!response.ok) return;
    const body = (await response.json()) as {
      messages?: Array<{
        ID: string;
        To?: Array<{ Address?: string }>;
        Subject?: string;
      }>;
    };
    return body.messages?.find(
      (message) =>
        message.Subject === subject &&
        message.To?.some((address) => address.Address === recipient),
    );
  });
}

localTest(
  "API signup and draft editing reach Mailpit after confirmation",
  async () => {
    const run = crypto.randomUUID().slice(0, 8);
    const slug = `api-${run}`;
    const recipient = `${slug}@example.test`;
    const cookie = await login();
    const createList = await fetch(`${appUrl}/admin/lists/new`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        slug,
        name: `API ${run}`,
        fromDomain: "lists.local",
        fromAddress: "news@lists.local",
      }),
    });
    expect(createList.status).toBe(302);

    const tokenForm = new URLSearchParams({ name: `Local API ${run}` });
    for (const scope of [
      "lists:read",
      "subscribers:write",
      "campaigns:read",
      "campaigns:write",
      "campaigns:send",
    ])
      tokenForm.append("scopes", scope);
    const minted = await fetch(`${appUrl}/admin/tokens`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: tokenForm,
    });
    expect(minted.status).toBe(201);
    const token = (await minted.text()).match(/lst_[a-f0-9]{64}/)?.[0];
    expect(token).toBeDefined();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const listsResponse = await fetch(`${appUrl}/api/v1/lists`, { headers });
    expect(listsResponse.status).toBe(200);
    const lists = (await listsResponse.json()) as {
      data: Array<{ id: number; slug: string }>;
    };
    const list = lists.data.find((item) => item.slug === slug);
    expect(list).toBeDefined();

    const subscribe = await fetch(`${appUrl}/api/v1/subscribers`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: recipient,
        lists: [slug],
        sendConfirmation: true,
      }),
    });
    expect(subscribe.status).toBe(201);
    const subscriber = (await subscribe.json()) as { data: { id: number } };
    const confirmation = await capturedMessage(
      recipient,
      "Confirm your subscription",
    );
    const detailResponse = await fetch(
      `${mailpitUrl}/api/v1/message/${confirmation.ID}`,
    );
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as { HTML: string };
    const confirmUrl = detail.HTML.match(
      /http:\/\/localhost:\d+\/confirm\/[a-f0-9]+\/lists\.local/,
    )?.[0];
    expect(confirmUrl).toBeDefined();
    const confirm = await fetch(`${appUrl}${new URL(confirmUrl!).pathname}`);
    expect(confirm.status).toBe(200);

    const draft = {
      subject: `Initial ${run}`,
      bodyMarkdown: "Initial local test copy.",
      fromAddress: "news@lists.local",
      audienceType: "list",
      audienceId: list!.id,
    };
    const created = await fetch(`${appUrl}/api/v1/campaigns`, {
      method: "POST",
      headers,
      body: JSON.stringify(draft),
    });
    expect(created.status).toBe(201);
    const campaign = (await created.json()) as { data: { id: number } };
    const revisedSubject = `Revised ${run}`;
    const updated = await fetch(
      `${appUrl}/api/v1/campaigns/${campaign.data.id}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          ...draft,
          subject: revisedSubject,
          bodyMarkdown: "Revised local test copy.",
        }),
      },
    );
    expect(updated.status).toBe(200);

    const testSend = await fetch(
      `${appUrl}/api/v1/campaigns/${campaign.data.id}/test-send`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          subscriberIds: [subscriber.data.id],
          confirm: true,
        }),
      },
    );
    expect(testSend.status).toBe(200);
    const testMessage = await capturedMessage(
      recipient,
      `Test: ${revisedSubject}`,
    );
    expect(testMessage.ID).toBeDefined();

    const sent = await fetch(
      `${appUrl}/api/v1/campaigns/${campaign.data.id}/send`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ confirm: true }),
      },
    );
    expect(sent.status).toBe(200);
    const message = await capturedMessage(recipient, revisedSubject);
    const campaignResponse = await fetch(
      `${mailpitUrl}/api/v1/message/${message.ID}`,
    );
    const campaignEmail = (await campaignResponse.json()) as {
      Text: string;
      ListUnsubscribe: { Header: string };
    };
    expect(campaignEmail.Text).toContain("Revised local test copy.");
    expect(campaignEmail.ListUnsubscribe.Header).toContain("unsubscribe");
  },
);

localTest(
  "compose stack captures outbound mail and processes inbound S3/SQS mail",
  async () => {
    const run = crypto.randomUUID().slice(0, 8);
    const slug = `e2e-${run}`;
    const recipient = `${slug}@example.test`;
    const cookie = await login();

    const createList = await fetch(`${appUrl}/admin/lists/new`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        slug,
        name: `E2E ${run}`,
        description: "Local stack test list",
        fromDomain: "lists.local",
        fromAddress: "news@lists.local",
      }),
    });
    expect(createList.status).toBe(302);

    const subscribe = await fetch(`${appUrl}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: recipient,
        firstName: "Local",
        lists: slug,
      }),
    });
    expect(subscribe.status).toBe(200);

    await eventually(async () => {
      const response = await fetch(`${mailpitUrl}/api/v1/messages`);
      if (!response.ok) return;
      const body = (await response.json()) as {
        messages?: Array<{
          To?: Array<{ Address?: string }>;
          Subject?: string;
        }>;
      };
      return body.messages?.some(
        (message) =>
          message.Subject === "Confirm your subscription" &&
          message.To?.some((address) => address.Address === recipient),
      )
        ? true
        : undefined;
    });

    const messageId = `local-${run}`;
    const subject = `Inbound local E2E ${run}`;
    const key = `inbound/${messageId}.eml`;
    const rawEmail = [
      `From: Sender <sender@example.test>`,
      `To: ${slug}@reply.lists.local`,
      `Subject: ${subject}`,
      `Message-ID: <${messageId}@example.test>`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hello from the local S3 and SQS integration test.",
    ].join("\r\n");

    const s3 = new S3Client({
      region: "us-east-1",
      endpoint: motoUrl,
      credentials,
      forcePathStyle: true,
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: "lists-inbound",
        Key: key,
        Body: rawEmail,
      }),
    );

    const sqs = new SQSClient({
      region: "us-east-1",
      endpoint: motoUrl,
      credentials,
    });
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: `${motoUrl}/123456789012/lists-inbound`,
        MessageBody: JSON.stringify({
          messageId,
          timestamp: new Date().toISOString(),
          source: "sender@example.test",
          from: ["sender@example.test"],
          to: [`${slug}@reply.lists.local`],
          subject,
          spamVerdict: "PASS",
          virusVerdict: "PASS",
          spfVerdict: "PASS",
          dkimVerdict: "PASS",
          dmarcVerdict: "PASS",
          s3Key: key,
          action: {
            type: "S3",
            bucketName: "lists-inbound",
            objectKeyPrefix: "inbound/",
            objectKey: key,
          },
        }),
      }),
    );

    await eventually(async () => {
      const response = await fetch(`${appUrl}/admin/inbound`, {
        headers: { cookie },
      });
      const html = await response.text();
      return response.ok && html.includes(subject) ? true : undefined;
    }, 35_000);
  },
);

localTest(
  "compose stack processes a compressed DMARC report from S3/SQS",
  async () => {
    const run = crypto.randomUUID().slice(0, 8);
    const messageId = `dmarc-${run}`;
    const reportId = `local-report-${run}`;
    const key = `dmarc/${messageId}.eml`;
    const cookie = await login();
    const xml = `<feedback>
    <report_metadata><org_name>Local Receiver ${run}</org_name><email>dmarc@example.test</email><report_id>${reportId}</report_id><date_range><begin>1787702400</begin><end>1787788800</end></date_range></report_metadata>
    <policy_published><domain>lists.local</domain><p>quarantine</p><sp>quarantine</sp><np>reject</np></policy_published>
    <record><row><source_ip>192.0.2.44</source_ip><count>12</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row><identifiers><header_from>lists.local</header_from><envelope_from>mail.lists.local</envelope_from></identifiers><auth_results><dkim><domain>lists.local</domain><result>pass</result></dkim><spf><domain>mail.lists.local</domain><result>pass</result></spf></auth_results></record>
  </feedback>`;
    const compressed = gzipSync(Buffer.from(xml));
    const rawEmail = [
      "From: DMARC Reporter <dmarc@example.test>",
      "To: reports@dmarc.lists.local",
      `Subject: DMARC aggregate ${reportId}`,
      `Message-ID: <${messageId}@example.test>`,
      "MIME-Version: 1.0",
      'Content-Type: application/gzip; name="report.xml.gz"',
      'Content-Disposition: attachment; filename="report.xml.gz"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(compressed).toString("base64"),
    ].join("\r\n");

    const s3 = new S3Client({
      region: "us-east-1",
      endpoint: motoUrl,
      credentials,
      forcePathStyle: true,
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: "lists-inbound",
        Key: key,
        Body: rawEmail,
      }),
    );
    const sqs = new SQSClient({
      region: "us-east-1",
      endpoint: motoUrl,
      credentials,
    });
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: `${motoUrl}/123456789012/lists-inbound`,
        MessageBody: JSON.stringify({
          kind: "dmarc",
          messageId,
          timestamp: new Date().toISOString(),
          source: "dmarc@example.test",
          from: ["dmarc@example.test"],
          to: ["reports@dmarc.lists.local"],
          subject: `DMARC aggregate ${reportId}`,
          spamVerdict: "PASS",
          virusVerdict: "PASS",
          spfVerdict: "PASS",
          dkimVerdict: "PASS",
          dmarcVerdict: "PASS",
          s3Key: key,
          action: {
            type: "S3",
            bucketName: "lists-inbound",
            objectKeyPrefix: "dmarc/",
            objectKey: key,
          },
        }),
      }),
    );

    await eventually(async () => {
      const response = await fetch(`${appUrl}/admin/dmarc`, {
        headers: { cookie },
      });
      const html = await response.text();
      return response.ok &&
        html.includes(`Local Receiver ${run}`) &&
        html.includes("192.0.2.44")
        ? true
        : undefined;
    }, 35_000);
  },
);
