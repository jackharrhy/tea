import { describe, expect, test } from "bun:test";
import { createTestDb } from "./helpers";
import * as schema from "../src/db/schema";
import { cleanupExpiredAuthRecords } from "../src/services/auth-maintenance";
import { shouldVerifySnsSignature } from "../src/routes/webhooks";

describe("auth maintenance", () => {
  test("removes expired ephemeral credentials while retaining valid ones", () => {
    const db = createTestDb();
    const user = db
      .insert(schema.users)
      .values({
        email: "owner@example.com",
        passwordHash: "hash",
        role: "owner",
      })
      .returning()
      .get();
    db.insert(schema.sessions)
      .values([
        {
          tokenHash: "expired",
          userId: user.id,
          expiresAt: "2026-01-01T00:00:00.000Z",
        },
        {
          tokenHash: "valid",
          userId: user.id,
          expiresAt: "2027-01-01T00:00:00.000Z",
        },
      ])
      .run();

    const result = cleanupExpiredAuthRecords(
      db,
      new Date("2026-06-01T00:00:00.000Z"),
    );
    expect(result.sessions).toBe(1);
    expect(
      db
        .select()
        .from(schema.sessions)
        .all()
        .map((row) => row.tokenHash),
    ).toEqual(["valid"]);
  });
});

describe("SNS verification configuration", () => {
  test("allows an explicit local bypass", () => {
    expect(
      shouldVerifySnsSignature({ SNS_SKIP_VERIFY: "true", NODE_ENV: "test" }),
    ).toBe(false);
  });

  test("never allows the bypass in production", () => {
    expect(
      shouldVerifySnsSignature({
        SNS_SKIP_VERIFY: "true",
        NODE_ENV: "production",
      }),
    ).toBe(true);
    expect(shouldVerifySnsSignature({ SNS_SKIP_VERIFY: "true" })).toBe(true);
  });
});
