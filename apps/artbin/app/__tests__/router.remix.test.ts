import {
  configureIdentityEnvironment,
  identityFetch,
} from "../../__tests__/identity-fixture.ts";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { eq } from "drizzle-orm";

import {
  cliLoginHandoffs,
  files,
  folders,
  jobs,
  remoteImports,
  sessions,
  users,
} from "#db";
import { setDbForTesting } from "#db/connection.server";
import { generateFolderPreview } from "#lib/folder-preview.server";
import { inspectBspDependencies } from "#lib/bsp-derivatives.server";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "../../__tests__/db.ts";
import { makeWAD3Texture } from "../../__tests__/wad-fixture.ts";
import { router } from "../router.ts";
import {
  mediaBspWalkabilityHref,
  mediaFileHref,
  mediaFolderPreviewHref,
  routes,
} from "../routes.ts";

const origin = "http://artbin.test";
const uploadsRoot = join(
  process.cwd(),
  "public",
  "uploads",
  "_remix-router-test",
);
const inboxUploadRoot = join(
  process.cwd(),
  "public",
  "uploads",
  "_inbox",
  "_remix-router-test",
);
const inboxDestinationRoot = join(
  process.cwd(),
  "public",
  "uploads",
  "remix-router-destination",
);
const providedAssetsRoot = join(
  process.cwd(),
  "public",
  "uploads",
  "_provided",
  "_remix-router-test",
);
const adminCookie = "artbin_session=admin-session";
const memberCookie = "artbin_session=member-session";
const originalCacheDirectory = process.env.ARTBIN_CACHE_DIR;

let database: TestDatabase;
let restoreIdentity: () => void;
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  restoreIdentity = configureIdentityEnvironment();
  globalThis.fetch = identityFetch();
  process.env.NODE_ENV = "test";
  process.env.ARTBIN_REQUIRE_AUTH = "1";
  process.env.ARTBIN_CACHE_DIR = join(uploadsRoot, "cache");
  database = createTestDatabase();
  applyMigrations(database.sqlite);
  setDbForTesting(database.db);
  await database.db.insert(users).values([
    {
      id: "admin",
      username: "admin",
      authSubject: "central-admin",
      isAdmin: true,
    },
    {
      id: "member",
      username: "member",
      authSubject: "central-member",
      isAdmin: false,
    },
  ]);
  await database.db.insert(sessions).values([
    {
      id: "admin-session",
      userId: "admin",
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      id: "member-session",
      userId: "member",
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]);
  await mkdir(uploadsRoot, { recursive: true });
});

afterEach(async () => {
  restoreIdentity();
  globalThis.fetch = originalFetch;
  database.close();
  await rm(uploadsRoot, { recursive: true, force: true });
  await rm(inboxUploadRoot, { recursive: true, force: true });
  await rm(inboxDestinationRoot, { recursive: true, force: true });
  await rm(providedAssetsRoot, { recursive: true, force: true });
  if (originalCacheDirectory === undefined) delete process.env.ARTBIN_CACHE_DIR;
  else process.env.ARTBIN_CACHE_DIR = originalCacheDirectory;
});

describe("native Remix router", () => {
  it("uses a document navigation to start cross-origin OAuth", async () => {
    const response = await router.fetch(request(routes.login.href()));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /href="\/auth\/login"[^>]*data-rmx-document=""/);
  });

  it("completes OAuth through the router and creates a session", async () => {
    const start = await router.fetch(request(routes.auth.login.href()));
    assert.equal(start.status, 302);

    const authorizeUrl = new URL(start.headers.get("location")!);
    assert.equal(authorizeUrl.pathname, "/oauth/v2/authorize");
    assert.equal(authorizeUrl.searchParams.get("client_id"), "artbin-browser");
    assert.equal(
      authorizeUrl.searchParams.get("code_challenge_method"),
      "S256",
    );
    assert.ok(authorizeUrl.searchParams.get("code_challenge"));

    const oauthCookie = start.headers.get("set-cookie")!;
    assert.match(oauthCookie, /^artbin_oauth=/);
    assert.match(oauthCookie, /HttpOnly/);
    assert.match(oauthCookie, /SameSite=Lax/);

    const tokenRequests: URLSearchParams[] = [];
    globalThis.fetch = identityFetch(
      authorizeUrl.searchParams.get("nonce")!,
      (body) => tokenRequests.push(body),
    );

    const callbackUrl = new URL(routes.auth.callback.href(), origin);
    callbackUrl.searchParams.set("code", "authorization-code");
    callbackUrl.searchParams.set(
      "state",
      authorizeUrl.searchParams.get("state")!,
    );
    const callback = await router.fetch(
      new Request(callbackUrl, {
        headers: { Cookie: oauthCookie.split(";", 1)[0]! },
      }),
    );

    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), routes.folders.href());
    const cookies = callback.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.ok(
      cookies.some(
        (cookie) =>
          cookie.startsWith("artbin_oauth=") && cookie.includes("Max-Age=0"),
      ),
    );
    assert.ok(
      cookies.some(
        (cookie) =>
          cookie.startsWith("artbin_session=") && cookie.includes("HttpOnly"),
      ),
    );

    assert.equal(tokenRequests.length, 1);
    assert.equal(tokenRequests[0]!.get("code"), "authorization-code");
    assert.equal(tokenRequests[0]!.get("client_id"), "artbin-browser");
    assert.ok(tokenRequests[0]!.get("code_verifier"));
    assert.equal((await database.db.select().from(sessions)).length, 3);
  });

  it("validates state and clears the transaction cookie on OAuth errors", async () => {
    const start = await router.fetch(request(routes.auth.login.href()));
    const authorizeUrl = new URL(start.headers.get("location")!);
    const oauthCookie = start.headers.get("set-cookie")!;

    const mismatchedUrl = new URL(routes.auth.callback.href(), origin);
    mismatchedUrl.searchParams.set("error", "access_denied");
    mismatchedUrl.searchParams.set("state", "wrong-state");
    const mismatched = await router.fetch(
      new Request(mismatchedUrl, {
        headers: { Cookie: oauthCookie.split(";", 1)[0]! },
      }),
    );
    assert.equal(mismatched.status, 302);
    assert.equal(
      mismatched.headers.get("location"),
      "/login?error=state_mismatch",
    );
    assert.match(
      mismatched.headers.get("set-cookie") ?? "",
      /artbin_oauth=.*Max-Age=0/,
    );

    const deniedUrl = new URL(routes.auth.callback.href(), origin);
    deniedUrl.searchParams.set("error", "access_denied");
    deniedUrl.searchParams.set(
      "state",
      authorizeUrl.searchParams.get("state")!,
    );
    const denied = await router.fetch(
      new Request(deniedUrl, {
        headers: { Cookie: oauthCookie.split(";", 1)[0]! },
      }),
    );
    assert.equal(denied.status, 302);
    assert.equal(denied.headers.get("location"), "/login?error=access_denied");
    assert.match(
      denied.headers.get("set-cookie") ?? "",
      /artbin_oauth=.*Max-Age=0/,
    );
  });

  it("exchanges a CLI OAuth callback for a single-use session handoff", async () => {
    const start = await router.fetch(
      request(`${routes.auth.cliAuthorize.href()}?port=43210`),
    );
    assert.equal(start.status, 302);
    const authorizeUrl = new URL(start.headers.get("location")!);
    const oauthCookie = start.headers.get("set-cookie")!;

    globalThis.fetch = identityFetch(authorizeUrl.searchParams.get("nonce")!);

    const callbackUrl = new URL(routes.auth.cliCallback.href(), origin);
    callbackUrl.searchParams.set("code", "cli-authorization-code");
    callbackUrl.searchParams.set(
      "state",
      authorizeUrl.searchParams.get("state")!,
    );
    const callback = await router.fetch(
      new Request(callbackUrl, {
        headers: { Cookie: oauthCookie.split(";", 1)[0]! },
      }),
    );
    assert.equal(callback.status, 302);
    assert.match(
      callback.headers.get("set-cookie") ?? "",
      /artbin_cli_oauth=.*Max-Age=0/,
    );

    const loopbackUrl = new URL(callback.headers.get("location")!);
    assert.equal(loopbackUrl.origin, "http://127.0.0.1:43210");
    assert.equal(loopbackUrl.pathname, "/callback");
    assert.equal(loopbackUrl.searchParams.has("session"), false);
    const handoffCode = loopbackUrl.searchParams.get("code");
    assert.ok(handoffCode);
    assert.equal((await database.db.select().from(sessions)).length, 2);
    assert.equal((await database.db.select().from(cliLoginHandoffs)).length, 1);

    const redeem = await router.fetch(
      request(routes.auth.cliRedeem.href(), undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: handoffCode }),
      }),
    );
    assert.equal(redeem.status, 200);
    assert.equal(redeem.headers.get("cache-control"), "no-store");
    const payload = (await redeem.json()) as { session: string };
    assert.ok(payload.session);
    assert.equal((await database.db.select().from(cliLoginHandoffs)).length, 0);
    assert.equal((await database.db.select().from(sessions)).length, 3);

    const replay = await router.fetch(
      request(routes.auth.cliRedeem.href(), undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: handoffCode }),
      }),
    );
    assert.equal(replay.status, 400);
    assert.equal(
      ((await replay.json()) as { error: { code: string } }).error.code,
      "invalid_grant",
    );
    assert.equal((await database.db.select().from(sessions)).length, 3);
  });

  it("never links an unmapped central identity by its matching username", async () => {
    const start = await router.fetch(request(routes.auth.login.href()));
    const authorization = new URL(start.headers.get("location")!);
    globalThis.fetch = identityFetch(
      authorization.searchParams.get("nonce")!,
      undefined,
      { subject: "central-other", username: "member" },
    );
    const callback = new URL(routes.auth.callback.href(), origin);
    callback.searchParams.set(
      "state",
      authorization.searchParams.get("state")!,
    );
    callback.searchParams.set("code", "code");
    const response = await router.fetch(
      new Request(callback, {
        headers: { Cookie: start.headers.get("set-cookie")!.split(";", 1)[0]! },
      }),
    );
    assert.equal(response.headers.get("location"), "/login?error=oauth_failed");
    assert.equal((await database.db.select().from(users)).length, 2);
    assert.equal((await database.db.select().from(sessions)).length, 2);
    const member = await database.db.query.users.findFirst({
      where: eq(users.id, "member"),
    });
    assert.equal(member?.authSubject, "central-member");
  });

  it("cannot extend an expired central sign-in by redeeming a live CLI handoff", async () => {
    await database.db.insert(cliLoginHandoffs).values({
      code: "expired-proof",
      userId: "member",
      expiresAt: new Date(Date.now() + 60000),
      sessionExpiresAt: new Date(Date.now() - 1000),
    });
    const response = await router.fetch(
      request(routes.auth.cliRedeem.href(), undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "expired-proof" }),
      }),
    );
    assert.equal(response.status, 400);
    assert.equal((await database.db.select().from(sessions)).length, 2);
  });

  it("rejects an expired CLI handoff without creating a session", async () => {
    await database.db.insert(cliLoginHandoffs).values({
      code: "expired-code",
      userId: "member",
      expiresAt: new Date(Date.now() - 1_000),
    });
    const response = await router.fetch(
      request(routes.auth.cliRedeem.href(), undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "expired-code" }),
      }),
    );
    assert.equal(response.status, 400);
    assert.equal((await database.db.select().from(sessions)).length, 2);
  });

  it("redirects protected pages to login", async () => {
    const response = await router.fetch(request(routes.folders.href()));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), routes.login.href());
  });

  it("renders the folders page with hydrated Remix controls", async () => {
    const folder = await seedFolder();
    await database.db.insert(files).values([
      {
        id: "browse-texture",
        path: "test/browse.png",
        name: "browse.png",
        mimeType: "image/png",
        size: 12,
        kind: "texture",
        folderId: folder.id,
        status: "approved",
      },
      {
        id: "browse-map",
        path: "test/de_example.bsp",
        name: "de_example.bsp",
        mimeType: "application/x-bsp",
        size: 24,
        kind: "map",
        folderId: folder.id,
        status: "approved",
        hasPreview: true,
      },
    ]);
    await database.db.insert(remoteImports).values({
      id: "browse-source",
      provider: "scmapdb",
      externalId: "test",
      destinationKey: "root",
      sourceUrl: "https://scmapdb.wikidot.com/map:test",
      title: "Test map",
      author: "Mapper",
      game: "Sven Co-op",
      metadata: "{}",
      folderId: folder.id,
    });
    const response = await router.fetch(
      request(routes.folder.index.href({ path: folder.slug }), adminCookie),
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Browse/);
    assert.match(html, /UploadControl/);
    assert.match(html, /I'm feeling lucky/);
    assert.match(html, /href="https:\/\/scmapdb\.wikidot\.com\/map:test"/);
    assert.match(html, /Test map on SCMapDB<\/a> by Mapper for Sven Co-op\./);
    assert.match(
      html,
      /\/media\/browse-map\/de_example\.bsp\.thumbnail\.webp\?thumbnail=1/,
    );
    assert.doesNotMatch(html, /react-router/);

    const folderMaps = await router.fetch(
      request(
        `${routes.folder.index.href({ path: folder.slug })}?view=maps`,
        adminCookie,
      ),
    );
    assert.equal(folderMaps.status, 200);
    const folderMapsHtml = await folderMaps.text();
    assert.match(
      folderMapsHtml,
      /href="\/folder\/test\?view=maps"[^>]*>Maps<span[^>]*>1<\/span>/,
    );
    assert.match(folderMapsHtml, /de_example\.bsp/);
    assert.match(
      folderMapsHtml,
      /\/media\/browse-map\/de_example\.bsp\.thumbnail\.webp\?thumbnail=1/,
    );
    assert.doesNotMatch(folderMapsHtml, /browse\.png/);

    const allMaps = await router.fetch(
      request(`${routes.folders.href()}?view=maps`, adminCookie),
    );
    assert.equal(allMaps.status, 200);
    const allMapsHtml = await allMaps.text();
    assert.match(allMapsHtml, /de_example\.bsp/);
    assert.doesNotMatch(allMapsHtml, /browse\.png/);
  });

  it("serves indexed media and previews without exposing the uploads tree", async () => {
    const folder = await seedFolder();
    const image = Buffer.from("indexed-media");
    const preview = Buffer.from("indexed-preview");
    const folderPreview = Buffer.from("folder-preview");
    const path = "_remix-router-test/{h2k.png";
    const folderPreviewPath = "_remix-router-test/_folder-preview.png";
    await Promise.all([
      writeFile(join(uploadsRoot, "{h2k.png"), image),
      writeFile(join(uploadsRoot, "{h2k.png.preview.png"), preview),
      writeFile(join(uploadsRoot, "_folder-preview.png"), folderPreview),
    ]);
    await database.db.insert(files).values({
      id: "special-media",
      path,
      name: "{h2k.png",
      mimeType: "image/png",
      size: image.length,
      kind: "texture",
      folderId: folder.id,
      hasPreview: true,
      status: "approved",
    });
    await database.db
      .update(folders)
      .set({ previewPath: folderPreviewPath })
      .where(eq(folders.id, folder.id));

    const original = await router.fetch(
      request(
        mediaFileHref({ id: "special-media", name: "{h2k.png" }),
        memberCookie,
      ),
    );
    assert.equal(original.status, 200);
    assert.equal(original.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), image);

    const generatedPreview = await router.fetch(
      request(
        mediaFileHref(
          { id: "special-media", name: "{h2k.png" },
          { preview: true },
        ),
        memberCookie,
      ),
    );
    assert.equal(generatedPreview.status, 200);
    assert.equal(
      generatedPreview.headers.get("cache-control"),
      "private, no-cache",
    );
    assert.deepEqual(
      Buffer.from(await generatedPreview.arrayBuffer()),
      preview,
    );

    const renderedFolderPreview = await router.fetch(
      request(
        mediaFolderPreviewHref({
          id: folder.id,
          previewPath: folderPreviewPath,
        }),
        memberCookie,
      ),
    );
    assert.equal(renderedFolderPreview.status, 200);
    assert.equal(
      renderedFolderPreview.headers.get("cache-control"),
      "private, no-cache",
    );
    assert.deepEqual(
      Buffer.from(await renderedFolderPreview.arrayBuffer()),
      folderPreview,
    );

    const unauthenticated = await router.fetch(
      request(mediaFileHref({ id: "special-media", name: "{h2k.png" })),
    );
    assert.equal(unauthenticated.status, 401);
    const rawUpload = await router.fetch(
      request(`/uploads/${path}`, memberCookie),
    );
    assert.equal(rawUpload.status, 404);
  });

  it("serves compact BSP thumbnails while keeping the full overview downloadable", async () => {
    const folder = await seedFolder();
    const png = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: "#e76532" },
    })
      .png()
      .toBuffer();
    await writeFile(join(uploadsRoot, "example.bsp.preview.png"), png);
    await database.db.insert(files).values({
      id: "thumbnail-map",
      path: "_remix-router-test/example.bsp",
      name: "example.bsp",
      mimeType: "application/x-bsp",
      size: 100,
      kind: "map",
      folderId: folder.id,
      hasPreview: true,
      status: "approved",
    });
    const file = { id: "thumbnail-map", name: "example.bsp" };

    const thumbnail = await router.fetch(
      request(
        mediaFileHref(file, { preview: true, thumbnail: true }),
        memberCookie,
      ),
    );
    assert.equal(thumbnail.status, 200);
    assert.equal(thumbnail.headers.get("content-type"), "image/webp");
    const thumbnailBytes = Buffer.from(await thumbnail.arrayBuffer());
    const metadata = await sharp(thumbnailBytes).metadata();
    assert.equal(metadata.width, 384);
    assert.equal(metadata.height, 384);
    assert.ok(thumbnailBytes.length < png.length);
    assert.equal(
      existsSync(join(uploadsRoot, "example.bsp.thumbnail.webp")),
      true,
    );

    const overview = await router.fetch(
      request(mediaFileHref(file, { preview: true }), memberCookie),
    );
    assert.equal(overview.status, 200);
    assert.deepEqual(Buffer.from(await overview.arrayBuffer()), png);

    const page = await router.fetch(
      request(
        routes.file.href({ path: "_remix-router-test/example.bsp" }),
        memberCookie,
      ),
    );
    assert.match(await page.text(), /Download 2048px overview/);

    const anonymous = await router.fetch(
      request(mediaFileHref(file, { preview: true, thumbnail: true })),
    );
    assert.equal(anonymous.status, 401);
  });

  it("renders the kitchen sink from the shared design system", async () => {
    const response = await router.fetch(
      request(routes.dev.kitchenSink.href(), adminCookie),
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Kitchen sink/);
    assert.match(html, /Foundations/);
    assert.match(html, /Forms/);
    assert.match(html, /Data display/);
    assert.match(html, /Media and files/);
    assert.match(html, /UploadControl/);
    assert.match(html, /LuckyButton/);
    assert.match(html, /role="progressbar"/);
    assert.match(html, /aria-label="Example import jobs"/);
  });

  it("renders every admin surface through native controllers", async () => {
    for (const href of [
      routes.admin.index.href(),
      routes.admin.jobs.index.href(),
      routes.admin.import.index.href(),
      routes.admin.inbox.index.href(),
      routes.admin.archives.index.href(),
      routes.admin.scanSettings.index.href(),
      routes.admin.orphans.index.href(),
      routes.admin.users.href(),
      routes.admin.mcp.href(),
    ]) {
      const response = await router.fetch(request(href, adminCookie));
      assert.equal(response.status, 200, href);
      assert.match(await response.text(), /Admin/);
    }
  });

  it("rejects non-admin users from admin routes", async () => {
    const response = await router.fetch(
      request(routes.admin.users.href(), memberCookie),
    );
    assert.equal(response.status, 403);
  });

  it("creates folders through the native API route", async () => {
    const response = await router.fetch(
      request(routes.api.folder.href(), adminCookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Native Remix",
          slug: "native-remix",
          parentId: null,
        }),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).folder.slug, "native-remix");
    const created = await database.db.query.folders.findFirst();
    assert.ok(created);
    assert.equal(created.slug, "native-remix");
  });

  it("lists folders through the CLI API", async () => {
    await seedFolder();
    const response = await router.fetch(
      request(`${routes.api.cli.foldersGet.href()}?tree=1`, memberCookie),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      folders: Array<{ slug: string }>;
    };
    assert.deepEqual(
      payload.folders.map((folder) => folder.slug),
      ["test"],
    );
  });

  it("renders a model page with the native Three.js client entry", async () => {
    const folder = await seedFolder();
    await database.db.insert(files).values({
      id: "model",
      path: "test/example.obj",
      name: "example.obj",
      mimeType: "model/obj",
      size: 100,
      kind: "model",
      folderId: folder.id,
      status: "approved",
    });
    const response = await router.fetch(
      request(routes.file.href({ path: "test/example.obj" }), adminCookie),
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /ModelViewer/);
    assert.match(html, /Loading model/);
  });

  it("renders BSP maps and serves nearby WAD and palette dependencies", async () => {
    const folder = await seedFolder();
    const bsp = await readFile(
      join(process.cwd(), "__tests__/fixtures/dm_barraco2.bsp"),
    );
    const wad = makeWAD3Texture("REDWALL");
    const providedWad = makeWAD3Texture("SITEWALL");
    const palette = Buffer.alloc(768, 42);
    const walkability = JSON.stringify({
      format: "tea-maps-walkability",
      version: 1,
    });
    const inspected = inspectBspDependencies(bsp);
    const manifest = {
      ...inspected,
      assets: {
        ...inspected.assets,
        wads: ["textures.wad", "halflife.wad"].map((name) => ({
          kind: "wad" as const,
          reference: { declaredPath: name, basename: name },
          candidates: [name],
        })),
      },
    };
    await Promise.all([
      mkdir(join(uploadsRoot, "maps"), { recursive: true }),
      mkdir(join(uploadsRoot, "gfx"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(uploadsRoot, "maps/example.bsp"), bsp),
      writeFile(
        join(uploadsRoot, "maps/example.artbin-bsp.json"),
        JSON.stringify(manifest),
      ),
      writeFile(
        join(uploadsRoot, "maps/example.tea-maps-walkability.json"),
        walkability,
      ),
      writeFile(join(uploadsRoot, "textures.wad"), wad),
      writeFile(join(uploadsRoot, "gfx/palette.lmp"), palette),
      mkdir(join(providedAssetsRoot, "goldsrc"), { recursive: true }).then(() =>
        writeFile(
          join(providedAssetsRoot, "goldsrc/halflife.wad"),
          providedWad,
        ),
      ),
    ]);
    await database.db.insert(files).values([
      {
        id: "bsp-map",
        path: "_remix-router-test/maps/example.bsp",
        name: "example.bsp",
        mimeType: "application/x-bsp",
        size: bsp.length,
        kind: "map",
        folderId: folder.id,
        status: "approved",
      },
      {
        id: "bsp-wad",
        path: "_remix-router-test/textures.wad",
        name: "textures.wad",
        mimeType: "application/x-wad",
        size: wad.length,
        kind: "archive",
        folderId: folder.id,
        status: "approved",
      },
      {
        id: "bsp-palette",
        path: "_remix-router-test/gfx/palette.lmp",
        name: "palette.lmp",
        mimeType: "application/octet-stream",
        size: palette.length,
        kind: "other",
        folderId: folder.id,
        status: "approved",
      },
      {
        id: "provided-bsp-wad",
        path: "_provided/_remix-router-test/goldsrc/halflife.wad",
        name: "halflife.wad",
        mimeType: "application/x-wad",
        size: providedWad.length,
        kind: "archive",
        folderId: folder.id,
        status: "approved",
      },
    ]);

    const page = await router.fetch(
      request(
        routes.file.href({ path: "_remix-router-test/maps/example.bsp" }),
        memberCookie,
      ),
    );
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /BspViewer/);
    assert.match(html, /Interactive BSP map/);
    assert.match(html, /palette\.lmp/);
    assert.doesNotMatch(html, /\/api\/bsp\/bsp-map\/palette/);
    assert.match(html, /textures\.wad/);
    assert.match(html, /example\.tea-maps-walkability\.json/);

    const walkabilityResponse = await router.fetch(
      request(
        mediaBspWalkabilityHref({ id: "bsp-map", name: "example.bsp" }),
        memberCookie,
      ),
    );
    assert.equal(walkabilityResponse.status, 200);
    assert.match(
      walkabilityResponse.headers.get("content-type") ?? "",
      /^application\/json/,
    );
    assert.equal(
      walkabilityResponse.headers.get("cache-control"),
      "private, no-cache",
    );
    assert.equal(await walkabilityResponse.text(), walkability);
  });

  it("serves WADs as path-based virtual folders and files", async () => {
    const folder = await seedFolder();
    const wad = makeWAD3Texture("REDWALL");
    await writeFile(join(uploadsRoot, "textures.wad"), wad);
    await database.db.insert(files).values({
      id: "wad",
      path: "_remix-router-test/textures.wad",
      name: "textures.wad",
      mimeType: "application/octet-stream",
      size: wad.length,
      kind: "archive",
      folderId: folder.id,
      status: "approved",
    });

    const library = await router.fetch(
      request(
        routes.folder.index.href({ path: "_remix-router-test/textures.wad" }),
        adminCookie,
      ),
    );
    assert.equal(library.status, 200);
    assert.match(await library.text(), /REDWALL/);

    const texture = await router.fetch(
      request(
        routes.file.href({
          path: "_remix-router-test/textures.wad/REDWALL.png",
        }),
        adminCookie,
      ),
    );
    assert.equal(texture.status, 200);
    assert.match(texture.headers.get("content-type") ?? "", /text\/html/);
  });

  it("surfaces recoverable WAD diagnostics without rejecting the library", async () => {
    const folder = await seedFolder();
    const wad = makeWAD3Texture("COMPRESSED");
    wad[wad.length - 32 + 13] = 1;
    await writeFile(join(uploadsRoot, "diagnostic.wad"), wad);
    await database.db.insert(files).values({
      id: "diagnostic-wad",
      path: "_remix-router-test/diagnostic.wad",
      name: "diagnostic.wad",
      mimeType: "application/octet-stream",
      size: wad.length,
      kind: "archive",
      folderId: folder.id,
      status: "approved",
    });

    const response = await router.fetch(
      request(
        routes.folder.index.href({ path: "_remix-router-test/diagnostic.wad" }),
        adminCookie,
      ),
    );
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /1 archive warning/);
    assert.match(html, /unsupported compression 1/);
  });

  it("uses virtual WAD textures in folder previews", async () => {
    const folder = await seedFolder();
    await database.db
      .update(folders)
      .set({ slug: "_remix-router-test" })
      .where(eq(folders.id, folder.id));
    const wad = makeWAD3Texture("PREVIEW");
    await writeFile(join(uploadsRoot, "preview.wad"), wad);
    await database.db.insert(files).values({
      id: "preview-wad",
      path: "_remix-router-test/preview.wad",
      name: "preview.wad",
      mimeType: "application/x-wad",
      size: wad.length,
      kind: "archive",
      folderId: folder.id,
      status: "approved",
    });

    const previewPath = await generateFolderPreview(folder.id);
    assert.equal(previewPath, "_remix-router-test/_folder-preview.png");
    const preview = await readFile(join(uploadsRoot, "_folder-preview.png"));
    assert.deepEqual(
      [...preview.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.equal(
      (
        await database.db.query.folders.findFirst({
          where: eq(folders.id, folder.id),
        })
      )?.previewPath,
      previewPath,
    );
  });

  it("clears a persisted folder preview when no previewable contents remain", async () => {
    const folder = await seedFolder();
    await database.db
      .update(folders)
      .set({ slug: "_remix-router-test" })
      .where(eq(folders.id, folder.id));
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(uploadsRoot, "preview.png"), image);
    await database.db.insert(files).values({
      id: "preview-image",
      path: "_remix-router-test/preview.png",
      name: "preview.png",
      mimeType: "image/png",
      size: image.length,
      kind: "texture",
      folderId: folder.id,
      status: "approved",
    });

    assert.equal(
      await generateFolderPreview(folder.id),
      "_remix-router-test/_folder-preview.png",
    );
    await database.db.delete(files).where(eq(files.id, "preview-image"));
    await rm(join(uploadsRoot, "preview.png"));

    assert.equal(await generateFolderPreview(folder.id), null);
    assert.equal(existsSync(join(uploadsRoot, "_folder-preview.png")), false);
    assert.equal(
      (
        await database.db.query.folders.findFirst({
          where: eq(folders.id, folder.id),
        })
      )?.previewPath,
      null,
    );
  });

  it("returns a random asset from the native lucky endpoint", async () => {
    const folder = await seedFolder();
    await database.db.insert(files).values({
      id: "texture",
      path: "test/lucky.png",
      name: "lucky.png",
      mimeType: "image/png",
      size: 12,
      kind: "texture",
      folderId: folder.id,
      status: "approved",
    });
    const form = new FormData();
    form.set("folderId", folder.id);
    const response = await router.fetch(
      request(routes.api.lucky.href(), memberCookie, {
        method: "POST",
        body: form,
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { href: "/file/test/lucky.png" });
  });

  it("queues supported site imports through the admin controller", async () => {
    const target = await seedFolder();
    const form = new FormData();
    form.set("intent", "remote-site-import");
    form.set("targetFolderId", target.id);
    form.set(
      "sourceUrls",
      [
        "https://gamebanana.com/mods/140244",
        "https://www.gamebanana.com/mods/140244?duplicate=1",
        "https://scmapdb.com/map:decay",
        "https://downloads.example.com/mapper-pack.zip",
      ].join("\n"),
    );
    const response = await router.fetch(
      request(routes.admin.import.action.href(), adminCookie, {
        method: "POST",
        body: form,
      }),
    );
    assert.equal(response.status, 303);
    const queued = await database.db.select().from(jobs);
    assert.equal(queued.length, 3);
    assert.deepEqual(
      queued.map(
        (job) =>
          (JSON.parse(job.input) as { targetFolderId: string }).targetFolderId,
      ),
      [target.id, target.id, target.id],
    );
  });

  it("rejects unsupported site imports before creating jobs", async () => {
    const form = new FormData();
    form.set("intent", "remote-site-import");
    form.set("sourceUrls", "https://example.com/maps/nope");
    const response = await router.fetch(
      request(routes.admin.import.action.href(), adminCookie, {
        method: "POST",
        body: form,
      }),
    );
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Supported sources/);
    assert.equal((await database.db.select().from(jobs)).length, 0);
  });

  it("reviews pending uploads through the native inbox action", async () => {
    await database.db.insert(users).values({
      id: "uploader",
      username: "uploader",
      authSubject: "fourm-uploader",
    });
    await database.db.insert(folders).values([
      { id: "inbox", name: "Inbox", slug: "_inbox" },
      {
        id: "upload-session",
        name: "Upload",
        slug: "_inbox/_remix-router-test",
        parentId: "inbox",
        ownerId: "uploader",
      },
    ]);
    await database.db.insert(files).values({
      id: "pending-upload",
      path: "_inbox/_remix-router-test/pending.png",
      name: "pending.png",
      mimeType: "image/png",
      size: 12,
      kind: "texture",
      folderId: "upload-session",
      uploaderId: "uploader",
      status: "pending",
    });
    const form = new FormData();
    form.set("intent", "reject");
    form.set("sessionFolderId", "upload-session");
    const response = await router.fetch(
      request(routes.admin.inbox.action.href(), adminCookie, {
        method: "POST",
        body: form,
      }),
    );
    assert.equal(response.status, 303);
    const record = await database.db.query.files.findFirst({
      where: eq(files.id, "pending-upload"),
    });
    assert.equal(record?.status, "rejected");
    assert.equal(record?.folderId, "inbox");
  });

  it("removes duplicate records while preserving the selected copy", async () => {
    const folder = await seedFolder();
    await database.db.insert(files).values([
      {
        id: "keep",
        path: "test/keep.png",
        name: "keep.png",
        mimeType: "image/png",
        size: 12,
        kind: "texture",
        folderId: folder.id,
        sha256: "same-hash",
      },
      {
        id: "remove",
        path: "test/remove.png",
        name: "remove.png",
        mimeType: "image/png",
        size: 12,
        kind: "texture",
        folderId: folder.id,
        sha256: "same-hash",
      },
    ]);
    const form = new FormData();
    form.set("intent", "delete-duplicates");
    form.set("keepId", "keep");
    form.set("deleteIds", JSON.stringify(["keep", "remove"]));
    const response = await router.fetch(
      request(routes.admin.orphans.action.href(), adminCookie, {
        method: "POST",
        body: form,
      }),
    );
    assert.equal(response.status, 303);
    assert.ok(
      await database.db.query.files.findFirst({ where: eq(files.id, "keep") }),
    );
    assert.equal(
      await database.db.query.files.findFirst({
        where: eq(files.id, "remove"),
      }),
      undefined,
    );
  });
});

function request(
  path: string,
  cookie?: string,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  return new Request(new URL(path, origin), { ...init, headers });
}

async function seedFolder() {
  const [folder] = await database.db
    .insert(folders)
    .values({ id: "folder", name: "Test", slug: "test", parentId: null })
    .returning();
  assert.ok(folder);
  return folder;
}
