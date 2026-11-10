import { test, expect, describe } from "bun:test";
import {
  generateToken,
  buildUnsubscribeUrl,
  buildPreferencesUrl,
  buildListUnsubscribeHeader,
} from "../src/compliance";

describe("generateToken", () => {
  test("returns a 64-char hex string", () => {
    const token = generateToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  test("returns unique values on each call", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });
});

describe("buildUnsubscribeUrl", () => {
  test("builds correct URL without listId", () => {
    const url = buildUnsubscribeUrl("https://example.com", "abc123");
    expect(url).toBe("https://example.com/unsubscribe/abc123");
  });

  test("builds correct URL with listId", () => {
    const url = buildUnsubscribeUrl("https://example.com", "abc123", 42);
    expect(url).toBe("https://example.com/unsubscribe/abc123/42");
  });
});

describe("buildPreferencesUrl", () => {
  test("builds correct URL", () => {
    const url = buildPreferencesUrl("https://example.com", "abc123");
    expect(url).toBe("https://example.com/preferences/abc123");
  });
});

describe("buildListUnsubscribeHeader", () => {
  test("returns correct RFC 8058 headers", () => {
    const headers = buildListUnsubscribeHeader(
      "https://example.com/unsubscribe/abc123",
    );
    expect(headers).toEqual({
      "List-Unsubscribe": "<https://example.com/unsubscribe/abc123>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
