import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { ArtbinClient } from "../src/artbin.js";

const config = {
  url: "https://artbin.example",
  issuer: "https://auth.example",
  projectId: "artbin-project",
  clientId: "tea-maps-service",
  clientSecret: "server-secret",
};

function url(input: Parameters<typeof fetch>[0]): URL {
  return new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
}

describe("Artbin machine client", () => {
  test("deduplicates token acquisition and reuses the short-lived bearer token", async () => {
    const requests: { url: URL; init?: RequestInit }[] = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const request = { url: url(input), ...(init ? { init } : {}) };
      requests.push(request);
      if (request.url.pathname === "/oauth/v2/token")
        return Response.json({
          access_token: "machine-token",
          token_type: "Bearer",
          expires_in: 600,
        });
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer machine-token",
      );
      if (request.url.pathname === "/api/assets")
        return Response.json({ assets: [], nextCursor: "opaque" });
      return Response.json({
        asset: {
          id: "asset-1",
          name: "test.wad",
          path: "test.wad",
          kind: "archive",
          mimeType: "application/x-wad",
          size: 1,
          sha256: "a".repeat(64),
          width: null,
          height: null,
          folder: null,
          tags: [],
        },
      });
    };
    const client = new ArtbinClient(config, mockFetch);

    await Promise.all([
      client.search(
        new URLSearchParams({ tag: "classic", cursor: "opaque cursor" }),
      ),
      client.metadata("asset-1"),
    ]);

    expect(
      requests.filter((request) => request.url.pathname === "/oauth/v2/token"),
    ).toHaveLength(1);
    const tokenRequest = requests[0]!;
    expect(new Headers(tokenRequest.init?.headers).get("authorization")).toBe(
      "Basic " +
        Buffer.from("tea-maps-service:server-secret").toString("base64"),
    );
    const tokenBody = new URLSearchParams(String(tokenRequest.init?.body));
    expect(tokenBody.get("grant_type")).toBe("client_credentials");
    expect(tokenBody.get("scope")?.split(" ")).toEqual([
      "openid",
      "urn:zitadel:iam:org:project:id:artbin-project:aud",
      "urn:zitadel:iam:org:projects:roles",
      "urn:zitadel:iam:org:project:role:assets-read",
      "urn:zitadel:iam:org:project:role:assets-content",
    ]);
    expect(tokenRequest.init?.redirect).toBe("error");
    expect(requests[1]!.url.searchParams.get("cursor")).toBe("opaque cursor");
    expect(requests[1]!.url.searchParams.get("tag")).toBe("classic");
  });

  test("renews shortly before expiry and retries invalid tokens only once", async () => {
    let now = 1_000;
    let tokenRequests = 0;
    let assetRequests = 0;
    const mockFetch: typeof fetch = async (input) => {
      const requestUrl = url(input);
      if (requestUrl.pathname === "/oauth/v2/token") {
        tokenRequests += 1;
        return Response.json({
          access_token: "token-" + tokenRequests,
          token_type: "bearer",
          expires_in: 60,
        });
      }
      assetRequests += 1;
      if (assetRequests === 1)
        return Response.json(
          { error: { code: "invalid_token", message: "expired" } },
          { status: 401 },
        );
      return Response.json({ assets: [], nextCursor: null });
    };
    const client = new ArtbinClient(config, mockFetch, () => now);

    await client.search(new URLSearchParams());
    expect(tokenRequests).toBe(2);
    now += 31_000;
    await client.search(new URLSearchParams());
    expect(tokenRequests).toBe(3);
  });

  test("passes the pinned digest and independently verifies downloaded bytes", async () => {
    const bytes = new TextEncoder().encode("WAD bytes");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const requested: URL[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const requestUrl = url(input);
      requested.push(requestUrl);
      if (requestUrl.pathname === "/oauth/v2/token")
        return Response.json({
          access_token: "machine-token",
          token_type: "Bearer",
          expires_in: 600,
        });
      return new Response(bytes);
    };
    const client = new ArtbinClient(config, mockFetch);

    await expect(client.content("asset/one", digest)).resolves.toEqual(bytes);
    expect(requested[1]!.pathname).toBe("/api/assets/asset%2Fone/content");
    expect(requested[1]!.searchParams.get("sha256")).toBe(digest);
    await expect(
      client.content("asset/one", "0".repeat(64)),
    ).rejects.toMatchObject({
      message: "Artbin content failed SHA-256 verification",
      status: 502,
    });
  });

  test("preserves hash conflicts and the public WAD inspection route", async () => {
    let responseKind: "conflict" | "wad" = "conflict";
    const mockFetch: typeof fetch = async (input) => {
      const requestUrl = url(input);
      if (requestUrl.pathname === "/oauth/v2/token")
        return Response.json({
          access_token: "machine-token",
          token_type: "Bearer",
          expires_in: 600,
        });
      if (responseKind === "conflict")
        return Response.json(
          {
            error: {
              code: "asset_hash_changed",
              message: "changed",
              details: { currentSha256: "b".repeat(64) },
            },
          },
          { status: 409 },
        );
      expect(requestUrl.pathname).toBe("/api/assets/wad-1/wad");
      return Response.json({
        asset: {
          id: "wad-1",
          name: "halflife.wad",
          path: "wads/halflife.wad",
          kind: "wad",
          mimeType: "application/octet-stream",
          size: 1,
          sha256: "a".repeat(64),
          width: null,
          height: null,
          folder: null,
          tags: [],
        },
        wad: { version: "WAD3", lumpCount: 0, textures: [] },
      });
    };
    const client = new ArtbinClient(config, mockFetch);

    await expect(client.content("wad-1", "a".repeat(64))).rejects.toMatchObject(
      {
        message: "Artbin asset changed since it was mounted",
        status: 409,
        code: "asset_hash_changed",
      },
    );
    responseKind = "wad";
    await expect(client.inspectWad("wad-1")).resolves.toMatchObject({
      wad: { version: "WAD3", textures: [] },
    });
  });
});
