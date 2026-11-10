import { test, expect, describe } from "bun:test";
import { buildRawEmail } from "../src/services/sender";

const defaultArgs = {
  from: '"My Newsletter" <news@example.com>',
  to: "reader@gmail.com",
  subject: "Issue #42",
  text: "Hello plain world",
  html: "<h1>Hello HTML world</h1>",
  fromDomain: "example.com",
  headers: {
    "List-Unsubscribe": "<https://example.com/unsub/abc>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "Reply-To": "mylist@reply.example.com",
  },
};

describe("buildRawEmail", () => {
  test("contains From header", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    // nodemailer may or may not quote the display name
    expect(raw.toString()).toMatch(/From:.*My Newsletter.*<news@example\.com>/);
  });

  test("contains To header", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    expect(raw.toString()).toContain("To: reader@gmail.com");
  });

  test("contains Subject header", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    expect(raw.toString()).toContain("Subject: Issue #42");
  });

  test("contains Message-ID with correct domain", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    const str = raw.toString();
    const match = str.match(/Message-ID: <([^>]+)>/);
    expect(match).not.toBeNull();
    expect(match![1]).toEndWith("@example.com");
  });

  test("returns messageId matching the header", async () => {
    const { raw, messageId } = await buildRawEmail(defaultArgs);
    expect(messageId).toMatch(/^<.+@example\.com>$/);
    expect(raw.toString()).toContain(`Message-ID: ${messageId}`);
  });

  test("contains Date header", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    expect(raw.toString()).toMatch(/Date: .+/);
  });

  test("contains List-Unsubscribe header", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    expect(raw.toString()).toContain(
      "List-Unsubscribe: <https://example.com/unsub/abc>",
    );
  });

  test("contains List-Unsubscribe-Post header", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    expect(raw.toString()).toContain(
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    );
  });

  test("contains Reply-To header", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    expect(raw.toString()).toContain("Reply-To: mylist@reply.example.com");
  });

  test("contains multipart/alternative boundary", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    // nodemailer may fold the Content-Type header across two lines
    expect(raw.toString()).toMatch(/Content-Type: multipart\/alternative/);
    expect(raw.toString()).toContain("boundary=");
  });

  test("contains text/plain part before text/html part", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    const str = raw.toString();
    const plainIndex = str.indexOf("Content-Type: text/plain");
    const htmlIndex = str.indexOf("Content-Type: text/html");
    expect(plainIndex).toBeGreaterThan(-1);
    expect(htmlIndex).toBeGreaterThan(-1);
    expect(plainIndex).toBeLessThan(htmlIndex);
  });

  test("contains the provided text content", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    expect(raw.toString()).toContain("Hello plain world");
  });

  test("contains the provided html content", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    expect(raw.toString()).toContain("<h1>Hello HTML world</h1>");
  });

  test("contains MIME-Version header", async () => {
    const { raw } = await buildRawEmail(defaultArgs);
    expect(raw.toString()).toContain("MIME-Version: 1.0");
  });

  test("converts data: URI images to CID inline attachments", async () => {
    const htmlWithImage =
      '<p>Hello</p><img src="data:image/webp;base64,ABC123" alt="test">';
    const { raw } = await buildRawEmail({
      ...defaultArgs,
      html: htmlWithImage,
    });
    const str = raw.toString();
    // Should NOT contain the data: URI
    expect(str).not.toContain("data:image/webp;base64,ABC123");
    // Should contain a CID reference
    expect(str).toContain("cid:");
    // Should have multipart/related structure
    expect(str).toContain("multipart/related");
    // Should have the inline attachment
    expect(str).toContain("Content-ID:");
    expect(str).toContain("Content-Disposition: inline");
  });
});
