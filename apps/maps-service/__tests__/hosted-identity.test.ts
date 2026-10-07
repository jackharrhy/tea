import { describe, expect, it } from "vitest";
import {
  createHostedId,
  HOSTED_ID_ALPHABET,
  HOSTED_ID_LENGTH,
  hostedSlug,
  isHostedId,
} from "../src/hosted-identity.js";

describe("hosted identity", () => {
  it("generates compact lowercase identifiers from the unambiguous alphabet", () => {
    const id = createHostedId();
    expect(id).toHaveLength(HOSTED_ID_LENGTH);
    expect(id).toMatch(new RegExp(`^[${HOSTED_ID_ALPHABET}]+$`));
    expect(isHostedId(id)).toBe(true);
    expect(isHostedId("9ae4a5d7-3ea0-4cdf-9164-757063c8815a")).toBe(false);
  });

  it("derives bounded decorative slugs without making map extensions part of the route", () => {
    expect(hostedSlug("Lambda Complex", "project")).toBe("lambda-complex");
    expect(hostedSlug("Test Chamber.map", "map")).toBe("test-chamber");
    expect(hostedSlug("A".repeat(80), "project")).toHaveLength(32);
    expect(hostedSlug("🧪", "map")).toBe("map");
  });
});
