import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { files, fileTags, folders, tags } from "#db";
import { setDbForTesting } from "#db/connection.server";
import { clearServiceAuthCacheForTesting } from "#lib/service-auth.server";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "../../../../__tests__/db.ts";
import { makeWAD3Texture } from "../../../../__tests__/wad-fixture.ts";
import { router } from "../../../router.ts";
import { routes } from "../../../routes.ts";

const origin = "http://artbin.test";
const uploadDirectory = join(
  process.cwd(),
  "public",
  "uploads",
  "_api-assets-test",
);
const originalFetch = globalThis.fetch;
const originalSecret = process.env.ARTBIN_4ORM_INTROSPECTION_SECRET;
const originalUrl = process.env.ARTBIN_4ORM_INTROSPECTION_URL;
const secret = "introspection-secret-that-must-not-leak";
const now = Math.floor(Date.now() / 1_000);

let database: TestDatabase;
let introspectionCalls: Array<{ token: string; authorization: string | null }>;

beforeEach(async () => {
  database = createTestDatabase();
  applyMigrations(database.sqlite);
  setDbForTesting(database.db);
  clearServiceAuthCacheForTesting();
  process.env.ARTBIN_4ORM_INTROSPECTION_SECRET = secret;
  process.env.ARTBIN_4ORM_INTROSPECTION_URL =
    "http://fourm.test/oauth/introspect";
  introspectionCalls = [];
  globalThis.fetch = introspectionFetch;
  await seedAssets();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  restoreEnvironment("ARTBIN_4ORM_INTROSPECTION_SECRET", originalSecret);
  restoreEnvironment("ARTBIN_4ORM_INTROSPECTION_URL", originalUrl);
  clearServiceAuthCacheForTesting();
  database.close();
  await rm(uploadDirectory, { recursive: true, force: true });
});

describe("service asset API", () => {
  it("requires an active service token and the route-specific scope", async () => {
    const missing = await router.fetch(request(routes.api.assets.href()));
    assert.equal(missing.status, 401);
    assert.match(
      missing.headers.get("www-authenticate") ?? "",
      /invalid_token/,
    );
    assert.equal(introspectionCalls.length, 0);

    for (const token of [
      "unknown-token",
      "revoked-token",
      "expired-token",
      "human-token",
    ]) {
      const inactive = await router.fetch(
        request(routes.api.assets.href(), { Authorization: `Bearer ${token}` }),
      );
      assert.equal(inactive.status, 401, token);
    }

    const insufficient = await router.fetch(
      request(routes.api.assets.href(), {
        Authorization: "Bearer content-token",
      }),
    );
    assert.equal(insufficient.status, 403);
    assert.match(
      insufficient.headers.get("www-authenticate") ?? "",
      /artbin:assets:read/,
    );

    const body = await insufficient.text();
    assert.doesNotMatch(body, /content-token/);
    assert.doesNotMatch(body, new RegExp(secret));
  });

  it("fails closed when introspection is unavailable or malformed", async () => {
    for (const token of [
      "introspection-error",
      "malformed-introspection",
      "network-error",
    ]) {
      clearServiceAuthCacheForTesting();
      const response = await router.fetch(
        request(routes.api.assets.href(), { Authorization: `Bearer ${token}` }),
      );
      assert.equal(response.status, 503, token);
      assert.equal(response.headers.get("retry-after"), "5");
      const serialized = `${JSON.stringify([...response.headers])}${await response.text()}`;
      assert.doesNotMatch(serialized, new RegExp(token));
      assert.doesNotMatch(serialized, new RegExp(secret));
    }

    clearServiceAuthCacheForTesting();
    delete process.env.ARTBIN_4ORM_INTROSPECTION_SECRET;
    const unconfigured = await router.fetch(
      request(routes.api.assets.href(), { Authorization: "Bearer read-token" }),
    );
    assert.equal(unconfigured.status, 503);
    process.env.ARTBIN_4ORM_INTROSPECTION_SECRET = secret;
  });

  it("lists only approved hashed assets with stable pagination and native filters", async () => {
    const first = await router.fetch(
      request(`${routes.api.assets.href()}?limit=1`, {
        Authorization: "Bearer read-token",
      }),
    );
    assert.equal(first.status, 200);
    const firstPage = (await first.json()) as AssetPage;
    assert.deepEqual(
      firstPage.assets.map((asset) => asset.id),
      ["approved-text"],
    );
    assert.ok(firstPage.nextCursor);
    assert.equal(firstPage.assets[0]!.folder.slug, "_api-assets-test");
    assert.deepEqual(firstPage.assets[0]!.tags, [
      { id: "tag-classic", name: "Classic", slug: "classic" },
    ]);

    const second = await router.fetch(
      request(
        `${routes.api.assets.href()}?limit=1&cursor=${firstPage.nextCursor}`,
        {
          Authorization: "Bearer read-token",
        },
      ),
    );
    assert.equal(second.status, 200);
    const secondPage = (await second.json()) as AssetPage;
    assert.deepEqual(
      secondPage.assets.map((asset) => asset.id),
      ["approved-wad"],
    );
    assert.equal(secondPage.nextCursor, null);

    const filtered = await router.fetch(
      request(
        `${routes.api.assets.href()}?kind=archive&tag=classic&q=library`,
        {
          Authorization: "Bearer read-token",
        },
      ),
    );
    assert.equal(filtered.status, 200);
    assert.deepEqual(
      ((await filtered.json()) as AssetPage).assets.map((asset) => asset.id),
      ["approved-wad"],
    );

    const literalWildcard = await router.fetch(
      request(`${routes.api.assets.href()}?q=100%25`, {
        Authorization: "Bearer read-token",
      }),
    );
    assert.equal(literalWildcard.status, 200);
    assert.deepEqual(((await literalWildcard.json()) as AssetPage).assets, []);
  });

  it("rejects invalid catalog input and opaque cursors", async () => {
    for (const query of [
      "kind=bogus",
      "limit=0",
      "limit=1.5",
      "cursor=not-json",
    ]) {
      const response = await router.fetch(
        request(`${routes.api.assets.href()}?${query}`, {
          Authorization: "Bearer read-token",
        }),
      );
      assert.equal(response.status, 400, query);
    }
  });

  it("returns canonical metadata by stable ID without disclosing unavailable records", async () => {
    const response = await router.fetch(
      request(routes.api.asset.href({ assetId: "approved-text" }), {
        Authorization: "Bearer read-token",
      }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { asset: Asset };
    assert.equal(payload.asset.sha256, digest(Buffer.from("asset-content")));
    assert.equal(payload.asset.mimeType, "text/plain");

    for (const assetId of ["pending", "missing-hash", "does-not-exist"]) {
      const unavailable = await router.fetch(
        request(routes.api.asset.href({ assetId }), {
          Authorization: "Bearer read-token",
        }),
      );
      assert.equal(unavailable.status, 404, assetId);
    }
  });

  it("requires a pinned digest and streams ranged original content", async () => {
    const sha256 = digest(Buffer.from("asset-content"));
    const href = routes.api.assetContent.href({ assetId: "approved-text" });

    const missingDigest = await router.fetch(
      request(href, { Authorization: "Bearer content-token" }),
    );
    assert.equal(missingDigest.status, 400);

    const changed = await router.fetch(
      request(`${href}?sha256=${"0".repeat(64)}`, {
        Authorization: "Bearer content-token",
      }),
    );
    assert.equal(changed.status, 409);
    const changedPayload = (await changed.json()) as {
      error: { code: string; details: { currentSha256: string } };
    };
    assert.equal(changedPayload.error.code, "asset_hash_changed");
    assert.equal(changedPayload.error.details.currentSha256, sha256);

    const ranged = await router.fetch(
      request(`${href}?sha256=${sha256}`, {
        Authorization: "Bearer content-token",
        Range: "bytes=1-4",
      }),
    );
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), "sset");
    assert.equal(ranged.headers.get("content-range"), "bytes 1-4/13");
    assert.equal(ranged.headers.get("etag"), `"${sha256}"`);
    assert.equal(ranged.headers.get("x-artbin-asset-id"), "approved-text");
    assert.equal(ranged.headers.get("x-artbin-sha256"), sha256);
    assert.match(ranged.headers.get("digest") ?? "", /^sha-256=/);
  });

  it("publishes a mapped WAD schema under the read scope", async () => {
    const response = await router.fetch(
      request(routes.api.assetWad.href({ assetId: "approved-wad" }), {
        Authorization: "Bearer read-token",
      }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      wad: {
        version: string;
        lumpCount: number;
        textures: Array<{ name: string; transparent: boolean }>;
      };
    };
    assert.equal(payload.wad.version, "WAD3");
    assert.equal(payload.wad.lumpCount, 1);
    assert.deepEqual(payload.wad.textures, [
      { index: 0, name: "LIBRARY", width: 8, height: 8, transparent: false },
    ]);

    const wrongScope = await router.fetch(
      request(routes.api.assetWad.href({ assetId: "approved-wad" }), {
        Authorization: "Bearer content-token",
      }),
    );
    assert.equal(wrongScope.status, 403);
  });

  it("caches successful introspection for no more than the token lifetime bound", async () => {
    const requestHeaders = { Authorization: "Bearer read-token" };
    const first = await router.fetch(
      request(routes.api.assets.href(), requestHeaders),
    );
    const second = await router.fetch(
      request(routes.api.assets.href(), requestHeaders),
    );
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(
      introspectionCalls.filter((call) => call.token === "read-token").length,
      1,
    );
  });
});

async function seedAssets() {
  await mkdir(uploadDirectory, { recursive: true });
  const text = Buffer.from("asset-content");
  const wad = makeWAD3Texture("LIBRARY");
  await Promise.all([
    writeFile(join(uploadDirectory, "asset.txt"), text),
    writeFile(join(uploadDirectory, "library.wad"), wad),
  ]);
  await database.db.insert(folders).values({
    id: "asset-folder",
    name: "API assets",
    slug: "_api-assets-test",
  });
  await database.db
    .insert(tags)
    .values({ id: "tag-classic", name: "Classic", slug: "classic" });
  await database.db.insert(files).values([
    {
      id: "approved-text",
      path: "_api-assets-test/asset.txt",
      name: "asset.txt",
      mimeType: "text/plain",
      size: text.length,
      kind: "config",
      folderId: "asset-folder",
      sha256: digest(text),
      status: "approved",
      createdAt: new Date("2026-08-29T12:00:00Z"),
    },
    {
      id: "approved-wad",
      path: "_api-assets-test/library.wad",
      name: "library.wad",
      mimeType: "application/x-wad",
      size: wad.length,
      kind: "archive",
      folderId: "asset-folder",
      sha256: digest(wad),
      status: "approved",
      createdAt: new Date("2026-08-29T11:00:00Z"),
    },
    {
      id: "pending",
      path: "_api-assets-test/pending.txt",
      name: "pending.txt",
      mimeType: "text/plain",
      size: 1,
      kind: "config",
      folderId: "asset-folder",
      sha256: "1".repeat(64),
      status: "pending",
      createdAt: new Date("2026-08-29T13:00:00Z"),
    },
    {
      id: "missing-hash",
      path: "_api-assets-test/no-hash.txt",
      name: "no-hash.txt",
      mimeType: "text/plain",
      size: 1,
      kind: "config",
      folderId: "asset-folder",
      sha256: null,
      status: "approved",
      createdAt: new Date("2026-08-29T14:00:00Z"),
    },
  ]);
  await database.db.insert(fileTags).values([
    { fileId: "approved-text", tagId: "tag-classic" },
    { fileId: "approved-wad", tagId: "tag-classic" },
  ]);
}

async function introspectionFetch(
  input: string | URL | Request,
  init?: RequestInit,
) {
  assert.equal(String(input), "http://fourm.test/oauth/introspect");
  const authorization = new Headers(init?.headers).get("authorization");
  assert.equal(
    authorization,
    `Basic ${Buffer.from(`artbin-server:${secret}`).toString("base64")}`,
  );
  const body = new URLSearchParams(String(init?.body));
  const token = body.get("token") ?? "";
  introspectionCalls.push({ token, authorization });
  assert.equal(body.get("token_type_hint"), "access_token");

  if (token === "network-error") throw new Error("4orm unavailable");
  if (token === "introspection-error")
    return new Response(null, { status: 401 });
  if (token === "malformed-introspection") return new Response("not json");
  if (["unknown-token", "revoked-token"].includes(token))
    return Response.json({ active: false });

  if (token === "expired-token") {
    return Response.json({
      active: true,
      client_id: "worldview-service",
      sub: "worldview-service",
      principal_type: "service",
      scope: "artbin:assets:read",
      token_type: "Bearer",
      exp: now - 1,
      iat: now - 601,
    });
  }
  if (token === "human-token") {
    return Response.json({
      active: true,
      client_id: "worldview",
      sub: "human-user",
      principal_type: "user",
      scope: "artbin:assets:read",
      token_type: "Bearer",
      exp: now + 600,
      iat: now,
    });
  }

  const scopes =
    token === "read-token"
      ? "artbin:assets:read"
      : token === "content-token"
        ? "artbin:assets:content"
        : "artbin:assets:read artbin:assets:content";
  return Response.json({
    active: true,
    client_id: "worldview-service",
    sub: "worldview-service",
    principal_type: "service",
    scope: scopes,
    token_type: "Bearer",
    exp: now + 600,
    iat: now,
  });
}

function request(path: string, headers?: HeadersInit): Request {
  return new Request(new URL(path, origin), { headers });
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

interface Asset {
  id: string;
  sha256: string;
  mimeType: string;
  folder: { slug: string };
  tags: Array<{ id: string; name: string; slug: string }>;
}

interface AssetPage {
  assets: Asset[];
  nextCursor: string | null;
}
