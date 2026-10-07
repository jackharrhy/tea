import { describe, expect, it, vi } from "vitest";
import {
  isCollaborationPath,
  isServicePath,
  proxyCollaborationRequest,
  proxyServiceRequest,
} from "../service-proxy.ts";

describe("Maps service pass through", () => {
  it("only accepts service paths", async () => {
    expect(isServicePath("/api/session")).toBe(true);
    expect(isServicePath("/auth/callback")).toBe(true);
    expect(isServicePath("/apiary/session")).toBe(false);
    const fetcher = vi.fn();
    const response = await proxyServiceRequest(
      new Request("https://maps.example.test/elsewhere"),
      "https://service.example.test",
      fetcher,
    );
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("forwards the request and preserves a login response", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "https://service.example.test/auth/login?returnTo=%2F",
      );
      expect(request.headers.get("cookie")).toBe("session=abc");
      expect(request.headers.has("host")).toBe(false);
      expect(request.redirect).toBe("manual");
      return new Response(null, {
        status: 303,
        headers: {
          Location: "https://identity.example.test/login",
          "Set-Cookie": "oauth=xyz; Path=/; HttpOnly",
        },
      });
    });
    const response = await proxyServiceRequest(
      new Request("https://maps.example.test/auth/login?returnTo=%2F", {
        headers: { Cookie: "session=abc" },
      }),
      "https://service.example.test",
      fetcher,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "https://identity.example.test/login",
    );
    expect(response.headers.get("Set-Cookie")).toContain("oauth=xyz");
  });

  it("reports an unavailable backend without leaking its address", async () => {
    const response = await proxyServiceRequest(
      new Request("https://maps.example.test/api/session"),
      "https://service.example.test",
      async () => {
        throw new Error("private backend details");
      },
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private backend details");
  });
});

describe("Maps collaboration pass through", () => {
  it("accepts room paths and forwards a ticketed WebSocket handshake", async () => {
    expect(isCollaborationPath("/sync/maps/map-1/live")).toBe(true);
    expect(isCollaborationPath("/sync/maps/map-1/snapshot")).toBe(true);
    expect(isCollaborationPath("/sync/maps/map-1/other")).toBe(false);
    expect(isCollaborationPath("/sync/other")).toBe(false);
    const upstreamResponse = new Response("upstream");
    const response = await proxyCollaborationRequest(
      new Request(
        "https://maps.example.test/sync/maps/map-1/live?access_token=ticket&actor=member",
        { headers: { Upgrade: "websocket" } },
      ),
      "https://sync.example.test",
      async (request) => {
        expect(request.url).toBe(
          "https://sync.example.test/sync/maps/map-1/live?access_token=ticket&actor=member",
        );
        expect(request.headers.get("Upgrade")).toBe("websocket");
        expect(request.headers.has("host")).toBe(false);
        return upstreamResponse;
      },
    );
    expect(response).toBe(upstreamResponse);
  });

  it("does not forward unrelated paths or expose upstream errors", async () => {
    const fetcher = vi.fn();
    expect(
      (
        await proxyCollaborationRequest(
          new Request("https://maps.example.test/sync/admin"),
          "https://sync.example.test",
          fetcher,
        )
      ).status,
    ).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
    const unavailable = await proxyCollaborationRequest(
      new Request("https://maps.example.test/sync/maps/map-1/snapshot"),
      "https://sync.example.test",
      async () => {
        throw new Error("private endpoint");
      },
    );
    expect(unavailable.status).toBe(502);
    expect(await unavailable.text()).not.toContain("private endpoint");
  });
});
