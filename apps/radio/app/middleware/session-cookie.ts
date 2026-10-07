import { Cookie, type CookieOptions } from "remix/cookie";

const encoder = new TextEncoder();

/**
 * Celld 0.4.0 can sign HMAC values but its Web Crypto `verify()` path rejects
 * valid signatures. Recomputing the HMAC and comparing it in constant time
 * preserves signed-cookie integrity across Celld and workerd.
 */
export class RadioSessionCookie extends Cookie {
  private secret: string;

  constructor(name: string, secret: string, options: CookieOptions) {
    super(name, options);
    this.secret = secret;
  }

  override get signed(): boolean {
    return true;
  }

  override async parse(headerValue: string | null): Promise<string | null> {
    let signedValue = await super.parse(headerValue);
    if (!signedValue) return null;
    let separator = signedValue.lastIndexOf(".");
    if (separator < 0) return null;
    let value = signedValue.slice(0, separator);
    let actualSignature = signedValue.slice(separator + 1);
    let expectedSignature = await hmac(value, this.secret);
    return constantTimeEqual(actualSignature, expectedSignature) ? value : null;
  }

  override async serialize(
    value: string,
    options?: Parameters<Cookie["serialize"]>[1],
  ): Promise<string> {
    return super.serialize(
      `${value}.${await hmac(value, this.secret)}`,
      options,
    );
  }
}

async function hmac(value: string, secret: string): Promise<string> {
  let key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  let signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(
    /=+$/,
    "",
  );
}

function constantTimeEqual(actual: string, expected: string): boolean {
  let difference = actual.length ^ expected.length;
  let length = Math.max(actual.length, expected.length);
  for (let index = 0; index < length; index++) {
    difference |=
      (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}
