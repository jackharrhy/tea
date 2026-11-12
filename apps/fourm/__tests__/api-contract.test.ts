import { expect, it } from "vitest";
import { apiPage, pageWrite } from "../app/api-contract.ts";

it("preserves the Go CLI boolean and default visibility contract", () => {
  expect(pageWrite({ title: "New page" }).is_public).toBe(1);
  expect(
    apiPage({ slug: "private", title: "Draft", is_public: 0 }).is_public,
  ).toBe(false);
  expect(
    apiPage({ slug: "public", title: "Published", is_public: 1 }).is_public,
  ).toBe(true);
  expect(() => pageWrite({ title: "Draft", is_public: "false" })).toThrow();
  expect(() => pageWrite({ title: "Draft", user_id: 72 })).toThrow();
});
