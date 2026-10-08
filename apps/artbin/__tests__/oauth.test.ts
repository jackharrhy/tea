import { afterEach, describe, expect, test, vi } from "vitest";
import {
  exchangeCode,
  generateCodeVerifier,
  generateCodeChallenge,
} from "#lib/oauth.server";

afterEach(() => vi.unstubAllGlobals());

describe("PKCE code generation", () => {
  test("generateCodeVerifier produces a base64url string of expected length", () => {
    const verifier = generateCodeVerifier();

    // 32 random bytes -> 43 chars in base64url (no padding)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBe(43);
  });

  test("generateCodeVerifier produces unique values", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  test("generateCodeChallenge produces a base64url SHA-256 hash", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    // SHA-256 -> 32 bytes -> 43 chars in base64url
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge.length).toBe(43);
  });

  test("same verifier always produces the same challenge", () => {
    const verifier = generateCodeVerifier();
    const challenge1 = generateCodeChallenge(verifier);
    const challenge2 = generateCodeChallenge(verifier);
    expect(challenge1).toBe(challenge2);
  });

  test("different verifiers produce different challenges", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(generateCodeChallenge(a)).not.toBe(generateCodeChallenge(b));
  });

  test("challenge differs from the verifier (is actually hashed)", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(challenge).not.toBe(verifier);
  });
});

describe("OAuth token response validation", () => {
  test.each([
    [{ token_type: "Bearer", expires_in: 3600 }, "access_token"],
    [
      { access_token: "token", token_type: "MAC", expires_in: 3600 },
      "token_type",
    ],
    [
      { access_token: "token", token_type: "Bearer", expires_in: 0 },
      "expires_in",
    ],
    [
      { access_token: "token", token_type: "Bearer", expires_in: "3600" },
      "expires_in",
    ],
  ])("rejects malformed token payloads", async (payload, expectedField) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(exchangeCode("code", "verifier")).rejects.toThrow(
      expectedField,
    );
  });

  test("accepts a case-insensitive Bearer token type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          access_token: "token",
          token_type: "bearer",
          expires_in: 3600,
        }),
      ),
    );
    await expect(exchangeCode("code", "verifier")).resolves.toEqual({
      access_token: "token",
      token_type: "bearer",
      expires_in: 3600,
    });
  });
});
