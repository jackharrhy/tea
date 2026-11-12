import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function targetFixture(authPath) {
  const result = spawnSync(
    "python3",
    [
      "-c",
      "import sqlite3,json,sys,pathlib;d=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True);d.row_factory=sqlite3.Row;u=d.execute('SELECT u.* FROM users u JOIN media m ON m.user_id=u.id WHERE u.is_admin=0 AND u.is_disabled=0 GROUP BY u.id ORDER BY sum(m.size_bytes),u.id LIMIT 1').fetchone();assert u;v={k:u[k] for k in ['id','username','display_name','is_admin','is_disabled','in_webring','updated_at']};v['media']=[dict(r) for r in d.execute('SELECT id,user_id,storage_path FROM media WHERE user_id=? ORDER BY id',(u['id'],))];assert d.execute('SELECT count(*) FROM users WHERE username=?',('fourm-copy-'+str(u['id'])+'-rename',)).fetchone()[0]==0;print(json.dumps(v))",
      join(dirname(authPath), "review.sqlite3"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, "Target selection failed");
  return JSON.parse(result.stdout);
}
function targetState(name, output, oracleRoot, userId) {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `import pathlib,sqlite3,json,sys
name,out,oracle,uid=sys.argv[1:];base=pathlib.Path(out)
if name=='oracle':p=pathlib.Path(oracle)/'oracle.sqlite3'
else:
 r=json.loads((base/'native/runtime.json').read_text());paths=set()
 for pid in r['pids']:
  folder=pathlib.Path('/proc')/str(pid)/'fd'
  if not folder.exists():continue
  for fd in folder.iterdir():
   try:
    link=fd.resolve()
    if link.name=='db.sqlite' and str(link).startswith(str(base/'native/replica')+'/'):paths.add(link)
   except OSError:pass
 assert len(paths)==1, 'Ambiguous active native DB';p=paths.pop()
d=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True);d.row_factory=sqlite3.Row;u=d.execute('SELECT id,username,display_name,is_admin,is_disabled,in_webring,updated_at FROM users WHERE id=?',(uid,)).fetchone();assert u;v=dict(u);v['media']=[dict(r) for r in d.execute('SELECT id,user_id,storage_path FROM media WHERE user_id=? ORDER BY id',(uid,))];assert d.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert not d.execute('PRAGMA foreign_key_check').fetchall();print(json.dumps(v))`,
      name,
      output,
      oracleRoot,
      String(userId),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, "Read-only target state verification failed");
  return JSON.parse(result.stdout);
}
export async function exerciseAdminAccounts({
  page,
  context,
  origin,
  name,
  output,
  oracleRoot,
  authPath,
  restart,
}) {
  const target = targetFixture(authPath);
  await writeFile(
    output + `/${name}-target-baseline.json`,
    JSON.stringify(target, null, 2),
  );
  const row = () => page.locator(`#user-row-${target.id}`);
  const action = (suffix) => `/admin/users/${target.id}/${suffix}`;
  const mediaURL = (path) =>
    origin + "/uploads/" + path.split("/").map(encodeURIComponent).join("/");
  const originalMedia = [];
  for (const media of target.media) {
    const r = await context.request.get(mediaURL(media.storage_path));
    assert.equal(r.status(), 200);
    originalMedia.push(hash(await r.body()));
  }
  await page.goto(origin + "/admin");
  page.on("dialog", (dialog) => dialog.accept());
  const checkbox = () => row().locator('[name="in_webring"]');
  const change = page.waitForResponse(
    (r) =>
      r.url() === origin + action("toggle-webring") &&
      r.request().method() === "POST",
  );
  await checkbox().setChecked(!target.in_webring);
  assert.equal((await change).status(), 200);
  await page.waitForFunction(
    ({ id, enabled }) =>
      document.querySelector(`#user-row-${id} [name="in_webring"]`).checked ===
      enabled,
    { id: target.id, enabled: !target.in_webring },
  );
  const identity = await context.request.post(origin + action("identity"), {
    headers: { Origin: origin, Accept: "application/json" },
  });
  assert.equal(identity.status(), 409);
  assert.ok(!identity.headers()["hx-redirect"]);
  if ((await row().getAttribute("open")) === null)
    await row().locator(":scope > summary").click();
  const disabled = page.waitForResponse(
    (r) =>
      r.url() === origin + action("toggle-disabled") &&
      r.request().method() === "POST",
  );
  await row().getByRole("button", { name: "disable", exact: true }).click();
  assert.equal((await disabled).status(), 200);
  await row().getByRole("button", { name: "re-enable", exact: true }).waitFor();
  const promote = page.waitForResponse(
    (r) =>
      r.url() === origin + action("toggle-admin") &&
      r.request().method() === "POST",
  );
  await row().getByRole("button", { name: "make admin", exact: true }).click();
  assert.equal((await promote).status(), 200);
  await page.waitForFunction(
    (id) => !document.querySelector(`#user-row-${id} form[action$="/rename"]`),
    target.id,
  );
  assert.equal(await row().locator('form[action$="/delete"]').count(), 0);
  const demote = await context.request.post(origin + action("toggle-admin"), {
    headers: { Origin: origin, "HX-Request": "true" },
  });
  assert.equal(demote.status(), 200);
  await page.reload();
  await row().locator(":scope > summary").click();
  const renamed = `fourm-copy-${target.id}-rename`;
  let rename = row().locator('form[action$="/rename"]');
  await rename.locator('[name="new_username"]').fill(renamed);
  await rename
    .locator('[name="new_display_name"]')
    .fill("Isolated renamed member");
  const sent = page.waitForResponse(
    (r) =>
      r.url() === origin + action("rename") && r.request().method() === "POST",
  );
  await rename.getByRole("button", { name: "save", exact: true }).click();
  const sentResponse = await sent;
  await writeFile(
    output + `/${name}-rename-response.json`,
    JSON.stringify(
      { status: sentResponse.status(), body: await sentResponse.text() },
      null,
      2,
    ),
  );
  assert.equal(sentResponse.status(), 200);
  await page.waitForFunction(
    ({ id, username }) =>
      document.querySelector(`#user-row-${id} > summary > strong`)
        .textContent ===
      "@" + username,
    { id: target.id, username: renamed },
  );
  let state = targetState(name, output, oracleRoot, target.id);
  assert.equal(state.id, target.id);
  assert.equal(state.username, renamed);
  assert.equal(state.is_disabled, 1);
  assert.equal(state.updated_at, target.updated_at);
  for (const [index, media] of target.media.entries()) {
    const newPath = renamed + media.storage_path.slice(target.username.length);
    const r = await context.request.get(mediaURL(newPath));
    await writeFile(
      output + `/${name}-restored-media-${index}.json`,
      JSON.stringify(
        {
          status: r.status(),
          headers: r.headers(),
          errorBody: r.status() === 200 ? undefined : await r.text(),
        },
        null,
        2,
      ),
    );
    assert.equal(r.status(), 200);
    assert.equal(hash(await r.body()), originalMedia[index]);
    assert.equal(
      (await context.request.get(mediaURL(media.storage_path))).status(),
      404,
    );
  }
  await restart(name);
  await page.goto(origin + "/admin");
  await row().locator(":scope > summary").click();
  await row().getByRole("button", { name: "re-enable", exact: true }).waitFor();
  rename = row().locator('form[action$="/rename"]');
  assert.equal(
    await rename.locator('[name="new_username"]').inputValue(),
    renamed,
  );
  if (process.env.FOURM_ACCOUNT_COLD_MEDIA !== "0")
    for (const [index, media] of target.media.entries()) {
      const response = await context.request.get(
        mediaURL(renamed + media.storage_path.slice(target.username.length)),
      );
      await writeFile(
        output + `/${name}-cold-media-${index}.json`,
        JSON.stringify({ status: response.status() }, null, 2),
      );
      assert.equal(response.status(), 200);
      assert.equal(hash(await response.body()), originalMedia[index]);
    }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await row().screenshot({ path: output + `/${name}-account-${width}.png` });
  }
  await rename.locator('[name="new_username"]').fill(target.username);
  await rename.locator('[name="new_display_name"]').fill(target.display_name);
  const restored = page.waitForResponse(
    (r) =>
      r.url() === origin + action("rename") && r.request().method() === "POST",
  );
  await rename.getByRole("button", { name: "save", exact: true }).click();
  const restoredResponse = await restored;
  await writeFile(
    output + `/${name}-rename-back-response.json`,
    JSON.stringify(
      {
        status: restoredResponse.status(),
        body: await restoredResponse.text(),
      },
      null,
      2,
    ),
  );
  assert.equal(restoredResponse.status(), 200);
  await page.waitForFunction(
    ({ id, username }) =>
      document.querySelector(`#user-row-${id} > summary > strong`)
        .textContent ===
      "@" + username,
    { id: target.id, username: target.username },
  );
  const enabled = page.waitForResponse(
    (r) =>
      r.url() === origin + action("toggle-disabled") &&
      r.request().method() === "POST",
  );
  await row().getByRole("button", { name: "re-enable", exact: true }).click();
  assert.equal((await enabled).status(), 200);
  await row().getByRole("button", { name: "disable", exact: true }).waitFor();
  const ring = page.waitForResponse(
    (r) =>
      r.url() === origin + action("toggle-webring") &&
      r.request().method() === "POST",
  );
  await checkbox().setChecked(Boolean(target.in_webring));
  assert.equal((await ring).status(), 200);
  state = targetState(name, output, oracleRoot, target.id);
  assert.deepEqual(state, target);
  for (const [index, media] of target.media.entries()) {
    const r = await context.request.get(mediaURL(media.storage_path));
    await writeFile(
      output + `/${name}-restored-media-${index}.json`,
      JSON.stringify(
        {
          status: r.status(),
          headers: r.headers(),
          errorBody: r.status() === 200 ? undefined : await r.text(),
        },
        null,
        2,
      ),
    );
    assert.equal(r.status(), 200);
    assert.equal(hash(await r.body()), originalMedia[index]);
  }
  await writeFile(
    output + `/${name}-account-receipt.json`,
    JSON.stringify(
      {
        status: "PASS",
        targetId: target.id,
        mediaFiles: target.media.length,
        flags: true,
        unmappedIdentityDenied: true,
        promotionHidesDangerControls: true,
        disabledTargetRename: true,
        timestampPreserved: true,
        coldRestart: true,
        exactTargetStateAndMediaRestored: true,
        integrity: true,
        foreignKeys: true,
        productionTouched: false,
      },
      null,
      2,
    ),
  );
}
