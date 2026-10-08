import { afterEach, describe, expect, test, vi } from "vitest";

import { redeemCliHandoff } from "../src/commands/login.ts";

afterEach(() => vi.unstubAllGlobals());

describe("CLI login handoff", () => {
  test("redeems the one-time code without placing credentials in the URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ session: "session-123" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      redeemCliHandoff("https://artbin.example", "handoff-123"),
    ).resolves.toBe("session-123");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://artbin.example/auth/cli/redeem"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "handoff-123" }),
      },
    );
  });

  test("rejects failed and malformed redemption responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 400 })),
    );
    await expect(
      redeemCliHandoff("https://artbin.example", "used-code"),
    ).rejects.toThrow("400");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ session: "" })),
    );
    await expect(
      redeemCliHandoff("https://artbin.example", "bad-code"),
    ).rejects.toThrow("invalid session");
  });
});
