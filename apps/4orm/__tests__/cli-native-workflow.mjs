import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
export async function exerciseNativeCli({
  binary,
  env,
  origin,
  upstream,
  configuration,
  credentialPath,
  directory,
}) {
  const run = (...args) =>
    new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
      child.stdout.on("data", (part) => (output += part));
      child.stderr.resume();
      child.once("error", reject);
      child.once("exit", (status) => {
        clearTimeout(timer);
        resolve({ status, output });
      });
    });
  const successful = async (...args) => {
    const result = await run(...args);
    assert.equal(
      result.status,
      0,
      "Native CLI operation failed: " + args.slice(0, 2).join(" "),
    );
    return result.output;
  };
  const credentials = () => readFile(credentialPath, "utf8").then(JSON.parse);
  const api = async (path, token) =>
    await fetch(origin + path, {
      headers: { Authorization: "Bearer " + token },
    });
  const revoke = (token) =>
    fetch(upstream + "/oauth/v2/revoke", {
      method: "POST",
      body: new URLSearchParams({ client_id: configuration.clientId, token }),
    });
  let saved = await credentials();
  const profile = await api("/api/v1/me", saved.access_token).then((r) =>
    r.json(),
  );
  assert.ok(
    profile.username && (await successful("whoami")).includes(profile.username),
  );
  const slug = "cli.caged-" + Date.now(),
    filename = "cli-caged-" + Date.now() + ".txt";
  let pageCreated = false,
    mediaId;
  try {
    const pageFile = join(directory, "page.html");
    await writeFile(pageFile, "<h1>Isolated native CLI</h1>");
    await successful(
      "page",
      "publish",
      "--slug",
      slug,
      "--title",
      "Isolated native CLI",
      pageFile,
    );
    pageCreated = true;
    assert.ok((await successful("page", "list")).includes(slug));
    const page = await api("/api/v1/pages/" + slug, saved.access_token).then(
      (r) => r.json(),
    );
    assert.equal(page.title, "Isolated native CLI");
    assert.equal(page.is_public, true);
    const mediaFile = join(directory, filename);
    await writeFile(mediaFile, "Isolated native CLI media");
    await successful("media", "upload", mediaFile);
    const media = await api("/api/v1/media", saved.access_token).then((r) =>
      r.json(),
    );
    const item = media.items.find((entry) =>
      entry.storage_path.endsWith("/" + filename),
    );
    assert.ok(item);
    mediaId = item.id;
    assert.ok((await successful("media", "list")).includes(filename));
    assert.equal(
      await fetch(origin + "/uploads/" + item.storage_path).then((r) =>
        r.text(),
      ),
      "Isolated native CLI media",
    );
    assert.equal((await revoke(saved.access_token)).status, 200);
    assert.equal((await api("/api/v1/me", saved.access_token)).status, 401);
    assert.ok((await successful("whoami")).includes(profile.username));
    const rotated = await credentials();
    assert.notEqual(rotated.access_token, saved.access_token);
    assert.notEqual(rotated.refresh_token, saved.refresh_token);
    const replay = await fetch(upstream + "/oauth/v2/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: configuration.clientId,
        refresh_token: saved.refresh_token,
      }),
    });
    assert.equal(replay.status, 400);
    saved = rotated;
  } finally {
    if (mediaId !== undefined)
      await successful("media", "delete", String(mediaId));
    if (pageCreated) await successful("page", "delete", slug);
  }
  assert.equal(
    (await api("/api/v1/pages/" + slug, saved.access_token)).status,
    404,
  );
  assert.equal((await revoke(saved.refresh_token)).status, 200);
  assert.equal((await revoke(saved.access_token)).status, 200);
  assert.equal((await api("/api/v1/me", saved.access_token)).status, 401);
  assert.notEqual((await run("whoami")).status, 0);
  return {
    profile: true,
    pagePublishListReadDelete: true,
    mediaUploadListBytesDelete: true,
    automaticRefreshAfter401: true,
    refreshRotationReplayDenied: true,
    immediateAccessRevocation401: true,
    revokedRefreshFailsClosed: true,
    createdContentRemoved: true,
  };
}
