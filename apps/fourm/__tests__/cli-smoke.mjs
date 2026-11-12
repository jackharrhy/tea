import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const binary = process.env.FOURM_CLI_BINARY;
const origin = process.env.FOURM_TEST_ORIGIN;
const tokenFile = process.env.FOURM_ACCESS_TOKEN_FILE;
if (!binary || !origin || !tokenFile)
  throw new Error(
    "Set an existing FOURM_CLI_BINARY, isolated FOURM_TEST_ORIGIN and fixture FOURM_ACCESS_TOKEN_FILE",
  );
const temporary = await mkdtemp(join(tmpdir(), "fourm-native-cli-"));
const token = (await readFile(tokenFile, "utf8")).trim();
const environment = {
  ...process.env,
  "4ORM_URL": origin,
  "4ORM_TOKEN": token,
  XDG_CONFIG_HOME: temporary,
};
const run = (...args) => {
  const result = spawnSync(binary, args, {
    env: environment,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, `CLI ${args.slice(0, 2).join(" ")} failed`);
  return result.stdout;
};
try {
  assert.ok(run("whoami").includes("jane"));
  const slug = "cli.compatibility-" + Date.now();
  const file = join(temporary, "page.html");
  await writeFile(file, "<h1>Native CLI page</h1>");
  run("page", "publish", "--slug", slug, "--title", "Native CLI page", file);
  assert.ok(run("page", "list").includes(slug));
  const page = await fetch(origin + "/api/v1/pages/" + slug, {
    headers: { Authorization: "Bearer " + token },
  }).then((response) => response.json());
  assert.equal(page.is_public, true);
  assert.equal(page.title, "Native CLI page");
  const image = join(temporary, "cli-media.txt");
  await writeFile(image, "Native CLI media bytes");
  run("media", "upload", image);
  assert.ok(run("media", "list").includes("cli-media.txt"));
  const media = await fetch(origin + "/api/v1/media", {
    headers: { Authorization: "Bearer " + token },
  }).then((response) => response.json());
  const item = media.items.find((entry) =>
    entry.storage_path.endsWith("cli-media.txt"),
  );
  assert.ok(item);
  assert.equal(
    await fetch(origin + "/uploads/" + item.storage_path).then((response) =>
      response.text(),
    ),
    "Native CLI media bytes",
  );
  run("media", "delete", String(item.id));
  run("page", "delete", slug);
  assert.equal(
    (
      await fetch(origin + "/api/v1/pages/" + slug, {
        headers: { Authorization: "Bearer " + token },
      })
    ).status,
    404,
  );
  console.log(
    "PASS: unchanged released Go CLI profile, publish/list/delete (including dotted slug), media upload/list/delete against native Celld",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
