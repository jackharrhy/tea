import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve as absolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
process.umask(0o077);
assert.equal(process.cwd(), "/home/jack/repos/personal/harrhy-fourm-celld");
const binary =
  "/home/jack/.local/state/form-harrhy-integration/candidate/tools/celld";
const state = await mkdtemp(join(tmpdir(), "fourm-orphan-celld-"));
const output =
  "/home/jack/.local/state/form-harrhy-integration/candidate/orphan-celld-" +
  new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const port = await new Promise((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const origin = `http://127.0.0.1:${port}`;
let running,
  logs = "";
const children = [];
const environment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("CELLD_")),
  ),
  CELLD_BUCKET: `sqlite://${join(state, "objects.sqlite3")}`,
  CELLD_WATCH: join(state, "replica"),
  CELLD_DURABILITY: "bucket",
  CELLD_ADDR: `127.0.0.1:${port}`,
  CELLD_INTERNAL_ADDR: "127.0.0.1:0",
  CELLD_ESBUILD: absolute("node_modules/.bin/esbuild"),
};
function run(args) {
  const child = spawn(binary, args, {
    cwd: state,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (p) => (logs += p));
  child.stderr.on("data", (p) => (logs += p));
  return child;
}
async function stop() {
  if (!running || running.exitCode !== null || running.signalCode !== null)
    return;
  const child = running;
  const exited = new Promise((done) => child.once("exit", done));
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }, 30000);
  await exited;
  clearTimeout(timer);
  running = undefined;
}
async function start() {
  running = run(["--no-control-plane"]);
  for (let i = 0; i < 200; i++) {
    assert.equal(running.exitCode, null);
    try {
      if ((await fetch(origin + "/health")).ok) return;
    } catch {}
    await delay(100);
  }
  throw Error("Native test readiness failed");
}
const request = (path, method = "GET", authenticated = true) =>
  fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      ...(authenticated ? { "X-Fixture-Actor": "admin" } : {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
try {
  const worker = `import {CommunityCell} from ${JSON.stringify(absolute("apps/fourm/app/data/community-cell.ts"))};
import {runtime} from ${JSON.stringify(absolute("apps/fourm/app/runtime.ts"))};
import {createAppRouter} from ${JSON.stringify(absolute("apps/fourm/app/router.tsx"))};
import {captureBackupSnapshot,readBackupSnapshot,canonicalTables} from ${JSON.stringify(absolute("apps/fourm/app/backup-snapshot.ts"))};
import {captureNativeBackup,readNativeBackup,restoreNativeBackup} from ${JSON.stringify(absolute("apps/fourm/app/native-backup.ts"))};
import {inspectBackupCatalogue} from ${JSON.stringify(absolute("apps/fourm/app/backup-catalogue.ts"))};
import {backupNameTime} from ${JSON.stringify(absolute("apps/fourm/app/backup-retention.ts"))};
export {CommunityCell};
const fieldHash=async tables=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalTables(tables))))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
export default {async fetch(request,env,context){const path=new URL(request.url).pathname;if(path==='/health')return new Response('ready');if(path.startsWith('/static/')||path.startsWith('/assets/'))return env.ASSETS.fetch(request);const store=runtime(env);if(path==='/seed'){await store.call('restore',{users:[{id:41,username:'fixture',display_name:'Fixture',password_hash:'',is_admin:1},{id:72,username:'member',display_name:'Member',password_hash:''}],media:[{id:1,user_id:41,storage_path:'fixture/kept.txt',mime_type:'text/plain',size_bytes:4},{id:2,user_id:41,storage_path:'fixture/missing.txt',mime_type:'text/plain',size_bytes:4}]});await env.MEDIA.put('fixture/kept.txt','kept');await env.MEDIA.put('fixture/orphan.txt','orphan');return new Response('seeded');}if(path==='/orphan-again'){await env.MEDIA.put('fixture/orphan.txt','orphan');return new Response('seeded');}if(path==='/backup-begin'){return Response.json(await store.call('beginBackup',41));}if(path==='/backup-status'){return Response.json(await store.call('backupStatus',41));}if(path==='/backup-finish'){const status=await store.call('backupStatus',41);const captured=await captureBackupSnapshot(env.MEDIA,status.pending.name,()=>store.call('exportArchive',41));return Response.json(await store.call('completeBackup',status.pending.name,captured.dbSize,captured.files));}if(path==='/backup-restore'){const status=await store.call('backupStatus',41);const snapshot=await readBackupSnapshot(env.MEDIA,status.backups[0].name);if(!snapshot)throw Error('Snapshot missing');await env.MEDIA.delete('fixture/kept.txt');for(const item of snapshot.objects){const object=await env.MEDIA.get('.backups/'+item.file);await env.MEDIA.put(item.storage_path,await object.arrayBuffer(),{httpMetadata:{contentType:item.content_type},customMetadata:{fourm_etag:item.etag,fourm_last_modified:item.last_modified,...(item.mtime_ns?{fourm_mtime_ns:item.mtime_ns}:{})}});}const target=env.COMMUNITIES.get(env.COMMUNITIES.idFromName('backup-restored-fixture'));const restored=await target.call('restore',[snapshot.tables]);if(!restored.ok)throw Error('Restore rejected');const readback=await target.call('exportArchive',[41]);return Response.json({tablesEqual:readback.ok&&canonicalTables(readback.value)===canonicalTables(snapshot.tables),kept:await(await env.MEDIA.get('fixture/kept.txt')).text(),tables:Object.keys(snapshot.tables).length});}if(path==='/claim'){return Response.json(await store.call('beginOrphanCleanup',41,'fixture/orphan.txt'));}if(path==='/recovery-check'){await store.call('createSession','c'.repeat(64),41,Date.now()+60000);await store.call('saveLogin','d'.repeat(64),JSON.stringify({fixture:true}));const snapshot=await store.call('exportRecovery',41);snapshot.sequences=[{name:'media_moves',seq:70}];const target=env.COMMUNITIES.get(env.COMMUNITIES.idFromName('native-recovery-fixture'));const restored=await target.call('restoreRecovery',[snapshot]);if(!restored.ok)throw Error('Native recovery rejected: '+restored.error);const readback=await target.call('exportRecovery',[41]);if(!readback.ok)throw Error('Native recovery readback failed');const replay=await target.call('restoreRecovery',[snapshot]);return Response.json({fingerprint:await fieldHash(readback.value.tables),tables:Object.keys(readback.value.tables).length,exact:canonicalTables(readback.value.tables)===canonicalTables(snapshot.tables),sequence:readback.value.sequences[0]?.seq,session:readback.value.tables.browser_sessions.length,login:readback.value.tables.login_transactions.length,replay:replay.ok&&replay.value.preserved});}if(path==='/recovery-inspect'){const target=env.COMMUNITIES.get(env.COMMUNITIES.idFromName('native-recovery-fixture'));const result=await target.call('exportRecovery',[41]);if(!result.ok)throw Error('Recovery readback failed');return Response.json({fingerprint:await fieldHash(result.value.tables),sequence:result.value.sequences[0]?.seq});}if(path==='/native-full-check'){await store.call('reserveArchiveObject','fixture/staged.txt');await env.MEDIA.put('fixture/staged.txt','stage',{customMetadata:{fixture_stage:'retained'}});await env.MEDIA.put('fixture/untracked.txt','extra');const original=await captureNativeBackup(env.MEDIA,'native-full-fixture',()=>store.call('exportRecovery',41));for(const file of original.files)await env.MEDIA.delete(file.key);const target=env.COMMUNITIES.get(env.COMMUNITIES.idFromName('full-native-backup-target'));const restored=await restoreNativeBackup(env.MEDIA,'native-full-fixture',async state=>{const result=await target.call('restoreRecovery',[state]);if(!result.ok)throw Error(result.error);return result.value;});const readback=await target.call('exportRecovery',[41]);const files=[];for(const file of original.files){const live=await env.MEDIA.get(file.key);files.push(!!live&&Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await live.arrayBuffer()))).map(byte=>byte.toString(16).padStart(2,'0')).join('')===file.sha256);}const replay=await restoreNativeBackup(env.MEDIA,'native-full-fixture',async state=>{const result=await target.call('restoreRecovery',[state]);if(!result.ok)throw Error(result.error);return result.value;});const verified=await readNativeBackup(env.MEDIA,'native-full-fixture');return Response.json({tables:restored.state.tables,files:restored.files,exact:readback.ok&&canonicalTables(readback.value.tables)===canonicalTables(original.recovery.tables),allFileBytes:files.every(Boolean),stagingMarker:(await env.MEDIA.head('fixture/staged.txt'))?.customMetadata?.fixture_stage==='retained',replay:replay.state.preserved,manifestVerified:verified?.files.length===3});}if(path==='/prune-check'){const day=new Date(Date.now()-3*86400000).toISOString().slice(0,10);const names=['01','02','03'].map(hour=>day+'T'+hour+'0000000Z-11111111-1111-4111-8111-111111111111');for(const name of names)await captureNativeBackup(env.MEDIA,name,()=>store.call('exportRecovery',41));const catalogue=await inspectBackupCatalogue(env.MEDIA);await store.call('adoptVerifiedBackups',41,catalogue.records);const cell=env.COMMUNITIES.get(env.COMMUNITIES.idFromName('fourm-community-v1'));const first=await cell.pruneBackups(41),repeat=await cell.pruneBackups(41),denied=await cell.pruneBackups(null);if(!first.ok||!repeat.ok)throw Error('Retention failed');return Response.json({removed:first.result.removed,replay:repeat.result.removed,denied:!denied.ok&&denied.status===403,retained:!!await readNativeBackup(env.MEDIA,names[2]),manual:!!await readNativeBackup(env.MEDIA,'native-full-fixture')});}if(path==='/manual-backup-check'){const cell=env.COMMUNITIES.get(env.COMMUNITIES.idFromName('fourm-community-v1'));const denied=await cell.runBackup(null);const [first,second]=await Promise.all([cell.runBackup(41),cell.runBackup(41)]);if(!first.ok||!second.ok)throw Error('Manual backup failed');return Response.json({denied:!denied.ok&&denied.status===403,complete:first.result.state==='complete',sameRun:first.result.name===second.result.name,files:first.result.file_count});}if(path==='/catalogue-check'){const job=await store.call('beginBackup',41);const fresh=await captureNativeBackup(env.MEDIA,String(job.name),()=>store.call('exportRecovery',41));const nativeTimestampRecognized=backupNameTime(String(job.name))===job.started_at;const target=env.COMMUNITIES.get(env.COMMUNITIES.idFromName('full-native-backup-target'));const before=await target.call('backupStatus',[41]);if(!before.ok)throw Error('Catalogue target unavailable');const verified=await inspectBackupCatalogue(env.MEDIA);const sourceAdopted=await store.call('adoptVerifiedBackups',41,verified.records);const sourceStatus=await store.call('backupStatus',41);const first=await target.call('adoptVerifiedBackups',[41,verified.records]);if(!first.ok)throw Error(first.error);const second=await target.call('adoptVerifiedBackups',[41,verified.records]);if(!second.ok)throw Error(second.error);const status=await target.call('backupStatus',[41]);const retention=await target.call('backupRetentionPlan',[41]);return Response.json({nativeTimestampRecognized,pendingResolved:sourceStatus.pending===null&&sourceAdopted.conflicts.length===0&&fresh.files.length===3,initial:before.value.backups.length,verified:verified.records.length,rejected:verified.rejected.length,adopted:first.value.adopted,preserved:second.value.preserved,conflicts:first.value.conflicts.length,count:status.ok?status.value.backups.length:-1,manualProtected:retention.ok&&retention.value.keep.includes('native-full-fixture')});}if(path==='/inspect'){return Response.json({records:await store.call('adminMediaRecords',41),pending:await store.call('hasOrphanCleanup'),kept:await (await env.MEDIA.get('fixture/kept.txt'))?.text(),orphan:!!(await env.MEDIA.head('fixture/orphan.txt'))});}const viewer={member:request.headers.get('X-Fixture-Actor')?await store.call('member',41):null,sessionHash:null};try{return await createAppRouter(env,store,viewer,p=>context.waitUntil(p)).fetch(request);}catch(error){return new Response(error.message,{status:error.status||500});}}};`;
  await writeFile(join(state, "worker.ts"), worker);
  await cp(absolute("apps/fourm/dist/client"), join(state, "assets"), {
    recursive: true,
  });
  const config = {
    name: "fourm-orphan-test",
    assets: {
      directory: "assets",
      binding: "ASSETS",
      run_worker_first: true,
    },
    main: "worker.ts",
    compatibility_date: "2026-11-12",
    compatibility_flags: ["nodejs_compat"],
    vars: {
      AUTH_PUBLIC_ORIGIN: origin,
      AUTH_ISSUER: "https://fixture.invalid",
      AUTH_CLIENT_ID: "fixture",
      AUTH_PROJECT_ID: "fixture",
      AUTH_ORGANIZATION_ID: "fixture",
    },
    durable_objects: {
      bindings: [{ name: "COMMUNITIES", class_name: "CommunityCell" }],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["CommunityCell"] }],
    r2_buckets: [{ binding: "MEDIA", bucket_name: "fourm-orphan-test" }],
  };
  await writeFile(join(state, "wrangler.jsonc"), JSON.stringify(config));
  const deployed = run(["deploy", join(state, "wrangler.jsonc")]);
  assert.equal(
    await new Promise((resolve, reject) => {
      deployed.once("error", reject);
      deployed.once("exit", resolve);
    }),
    0,
  );
  await start();
  assert.equal((await request("/seed", "POST")).status, 200);
  for (const path of [
    "/admin/orphans",
    "/admin/cleanup/files",
    "/admin/cleanup/records",
  ])
    assert.equal(
      (await request(path, path.includes("cleanup") ? "POST" : "GET", false))
        .status,
      403,
    );
  const scan = await request("/admin/orphans");
  await writeFile(
    join(output, "scan-response.json"),
    JSON.stringify({ status: scan.status, body: await scan.clone().text() }),
  );
  assert.equal(scan.status, 200);
  const html = await scan.text();
  assert.ok(
    html.includes("fixture/orphan.txt") && html.includes("fixture/missing.txt"),
  );
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      extraHTTPHeaders: { "X-Fixture-Actor": "admin" },
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block",
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const openScan = async () => {
      await page.goto(origin + "/admin");
      const panel = page.locator("details.panel").filter({
        has: page.locator("summary h2").filter({ hasText: /^storage health$/ }),
      });
      await panel.locator("summary").click();
      await panel
        .getByRole("button", { name: "scan for orphans", exact: true })
        .click();
      await panel
        .getByRole("heading", { name: "orphaned records", exact: true })
        .waitFor();
      return panel;
    };
    const panel = await openScan();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await panel.screenshot({
        path: join(output, `native-positive-storage-${width}.png`),
      });
    }
    for (const [kind, label] of [
      ["files", "file(s)"],
      ["records", "record(s)"],
    ]) {
      if (kind === "records") await openScan();
      page.once("dialog", (dialog) => dialog.accept());
      const response = page.waitForResponse(
        (r) =>
          r.url() === origin + `/admin/cleanup/${kind}` &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", {
          name: `delete 1 orphaned ${label}`,
          exact: true,
        })
        .click();
      assert.equal((await response).status(), 200);
      await page
        .getByText(`deleted 1 orphaned ${label}.`, { exact: true })
        .waitFor();
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
  assert.equal((await request("/orphan-again", "POST")).status, 200);
  assert.equal(await (await request("/claim", "POST")).json(), true);
  const backupRun = await (await request("/backup-begin", "POST")).json();
  assert.equal(backupRun.state, "pending");
  assert.deepEqual(
    await (await request("/backup-begin", "POST")).json(),
    backupRun,
  );
  await stop();
  await rm(join(state, "replica"), { recursive: true, force: true });
  await start();
  assert.equal((await (await request("/inspect")).json()).pending, true);
  assert.equal(
    (await (await request("/backup-status")).json()).pending.name,
    backupRun.name,
  );
  const backupFinished = await (await request("/backup-finish", "POST")).json();
  assert.equal(backupFinished.state, "complete");
  const backupStatus = await (await request("/backup-status")).json();
  assert.equal(backupStatus.pending, null);
  assert.equal(backupStatus.backups[0].name, backupRun.name);
  const restoredBackup = await (
    await request("/backup-restore", "POST")
  ).json();
  assert.deepEqual(restoredBackup, {
    tablesEqual: true,
    kept: "kept",
    tables: 18,
  });

  const cleanup = await request("/admin/cleanup/files", "POST");
  assert.equal(cleanup.status, 303);
  assert.equal(cleanup.headers.get("location"), "/admin?cleaned_files=1");
  const missing = await request("/admin/cleanup/records", "POST");
  assert.equal(missing.status, 303);
  assert.equal(missing.headers.get("location"), "/admin?cleaned_records=0");
  const after = await (await request("/inspect")).json();
  assert.deepEqual(after, {
    records: [{ id: 1, storage_path: "fixture/kept.txt" }],
    pending: false,
    kept: "kept",
    orphan: false,
  });
  assert.equal(
    (await request("/admin/cleanup/files", "POST")).headers.get("location"),
    "/admin?cleaned_files=0",
  );
  const recovery = await (await request("/recovery-check", "POST")).json();
  const { fingerprint, ...recoverySummary } = recovery;
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(recoverySummary, {
    tables: 30,
    exact: true,
    sequence: 70,
    session: 1,
    login: 1,
    replay: true,
  });
  await stop();
  await rm(join(state, "replica"), { recursive: true, force: true });
  await start();
  const coldRecovery = await (await request("/recovery-inspect")).json();
  assert.deepEqual(coldRecovery, { fingerprint, sequence: 70 });
  const fullBackup = await (await request("/native-full-check", "POST")).json();
  assert.deepEqual(fullBackup, {
    tables: 30,
    files: 3,
    exact: true,
    allFileBytes: true,
    stagingMarker: true,
    replay: true,
    manifestVerified: true,
  });
  for (const method of ["GET", "HEAD"]) {
    const denied = await fetch(
      origin + "/uploads/.backups/native/native-full-fixture.json",
      { method },
    );
    assert.equal(denied.status, 404);
  }
  const catalogue = await (await request("/catalogue-check", "POST")).json();
  assert.deepEqual(catalogue, {
    initial: 0,
    nativeTimestampRecognized: true,
    pendingResolved: true,
    verified: 2,
    rejected: 0,
    adopted: 2,
    preserved: 2,
    conflicts: 0,
    count: 2,
    manualProtected: true,
  });
  const manualBackup = await (
    await request("/manual-backup-check", "POST")
  ).json();
  assert.deepEqual(manualBackup, {
    denied: true,
    complete: true,
    sameRun: true,
    files: 3,
  });
  for (const [path, method] of [
    ["/admin/backups", "GET"],
    ["/admin/backups/run", "POST"],
  ])
    assert.equal((await request(path, method, false)).status, 403);
  const beforeUI = await (await request("/backup-status")).json();
  const backupBrowser = await chromium.launch();
  try {
    const context = await backupBrowser.newContext({
      extraHTTPHeaders: { "X-Fixture-Actor": "admin" },
      serviceWorkers: "block",
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/admin");
    const panel = page.locator("details.panel").filter({
      has: page.locator("summary h2").filter({ hasText: /^backups$/ }),
    });
    await panel.locator("summary").click();
    await panel
      .getByRole("button", { name: "view full backup list", exact: true })
      .click();
    await panel
      .getByRole("columnheader", { name: "snapshot", exact: true })
      .waitFor();
    const response = page.waitForResponse(
      (r) =>
        r.url() === origin + "/admin/backups/run" &&
        r.request().method() === "POST",
    );
    await panel
      .getByRole("button", { name: "run backup now", exact: true })
      .click();
    assert.equal((await response).status(), 200);
    await panel.locator("#backup-status .ok").waitFor();
    assert.match(
      await panel.locator("#backup-status").innerText(),
      /^backup complete:/,
    );
    await page.reload();
    await panel.locator("summary").click();
    await panel
      .getByRole("button", { name: "view full backup list", exact: true })
      .click();
    await panel
      .getByRole("columnheader", { name: "snapshot", exact: true })
      .waitFor();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        true,
      );
      await panel.screenshot({
        path: join(output, `native-backups-${width}.png`),
      });
    }
    assert.deepEqual(errors, []);
  } finally {
    await backupBrowser.close();
  }
  const afterUI = await (await request("/backup-status")).json();
  assert.equal(afterUI.backups.length, beforeUI.backups.length + 1);
  assert.equal(afterUI.pending, null);
  await stop();
  await rm(join(state, "replica"), { recursive: true, force: true });
  await start();
  assert.deepEqual(await (await request("/backup-status")).json(), afterUI);
  const pruning = await (await request("/prune-check", "POST")).json();
  assert.deepEqual(pruning, {
    removed: 2,
    replay: 0,
    denied: true,
    retained: true,
    manual: true,
  });
  await writeFile(
    join(output, "receipt.json"),
    JSON.stringify(
      {
        status: "PASS",
        scope:
          "actual native Celld DO/R2, isolated synthetic fixture, actual admin routes; no real OAuth or real-content browser claim",
        browserCleanupControls: true,
        backupRunStateRecovery: true,
        fullNativeBackup: fullBackup,
        catalogueRecovery: catalogue,
        manualBackup,
        pruning,
        backupAdminBrowser: {
          run: true,
          list: true,
          reload: true,
          coldReplicaRecovery: true,
          desktopMobile: true,
          anonymousDenied: true,
        },
        backupNamespacePublicGetHeadDenied: true,
        nativeOperationalRecovery: {
          ...recoverySummary,
          coldRestartAfterRestore: true,
          replicaRemovedAfterRestore: true,
        },
        operationalSequenceFixture:
          "synthetic historical high-water70; not production state",
        backupSnapshotCaptureAndRestore: true,
        backupRunLimit:
          "Isolated synthetic content archive; operational-state/full-storage backup, scheduling and real-cohort capture not yet accepted",
        coldRestart: true,
        replicaRemoved: true,
        authorityRecovered: true,
        orphanFilesDeleted: 1,
        missingRecordsDeleted: 1,
        keptBytesPreserved: true,
        anonymousDenied: true,
        replayRemoved: 0,
        productionTouched: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(join(output, "runtime.log"), logs);
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify(
      { status: "FAIL", message: error.message, stack: error.stack },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await stop();
  await writeFile(join(output, "runtime.log"), logs);
  assert.ok(
    children.every((c) => c.exitCode !== null || c.signalCode !== null),
    "Owned test child remains running",
  );
  await rm(state, { recursive: true, force: true });
  console.log(output);
}
