import { describe, expect, test } from "vitest";
import {
  createLoginTransaction,
  validLoginTransaction,
  browserRedirectUri,
  getCliRedirectUri,
} from "#lib/oauth.server";
describe("Artbin central login entry points", () => {
  test("uses separate browser and CLI callbacks", () => {
    expect(browserRedirectUri()).toMatch(/\/auth\/callback$/);
    expect(getCliRedirectUri()).toMatch(/\/auth\/cli\/callback$/);
  });
  test("transaction proof is fresh and rejects missing or mismatched browser state", () => {
    const transaction = createLoginTransaction();
    expect(validLoginTransaction(transaction, transaction.state)).toBe(true);
    expect(validLoginTransaction(transaction, null)).toBe(false);
    expect(
      validLoginTransaction(
        { ...transaction, createdAt: 1 },
        transaction.state,
      ),
    ).toBe(false);
  });
});
