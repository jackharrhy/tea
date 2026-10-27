import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Uses only a disposable container layer: no host ports, mounts or network.
const [app, image] = process.argv.slice(2);
const configs = {
  cms: {
    port: 4351,
    env: [],
    paths: [
      ["/healthz", 200, { host: "andrew.jackharrhy.dev" }],
      ["/tea/login", 200, { host: "andrew.jackharrhy.dev" }],
    ],
  },
  artbin: {
    port: 3000,
    env: [],
    paths: [
      ["/login", 200],
      ["/api/assets", 401],
    ],
  },
  "letters-to-steve": {
    port: 44110,
    env: ["STEVE_ADMIN_PASSWORD=container-smoke-only"],
    paths: [
      ["/", 200],
      ["/steve", 401],
    ],
  },
  marky: { port: 44100, env: ["MARKY_AUTH=anonymous"], paths: [["/", 200]] },
  "maps-service": {
    port: 8792,
    env: [],
    paths: [
      ["/health", 200],
      ["/api/projects", 401],
    ],
  },
  "maps-compiler": {
    port: 8788,
    env: [],
    paths: [
      ["/health", 503],
      ["/capabilities", 200],
      ["/compile", 503, {}, "POST"],
    ],
  },
};
assert.ok(configs[app] && image, "Usage: node scripts/ci/node-image-smoke.mjs APP IMAGE");
const config = configs[app];
if (process.argv[4] === "gower") {
  assert.equal(app, "maps-compiler");
  config.env = ["TEA_MAPS_GAME_PROFILE=gower"];
}
const docker = (...args) => {
  const output = execFileSync("docker", args, { encoding: "utf8", timeout: 120_000 });
  if (args[0] === "exec" || args.includes(runtimeCheck)) process.stdout.write(output);
  return output;
};
const runtimeCheck = `
const assert = require('node:assert/strict');
assert.equal(process.versions.node.split('.')[0], '26');
assert.equal(process.config.variables.v8_enable_pointer_compression, 1);
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE smoke(value TEXT); INSERT INTO smoke VALUES ('compressed')");
assert.equal(db.prepare('SELECT value FROM smoke').get().value, 'compressed');
db.close();
console.log(JSON.stringify({node: process.version, compression: process.config.variables.v8_enable_pointer_compression, uid: process.getuid()}));
assert.notEqual(process.getuid(), 0);
`;
// Fail before startup when a standard Node image accidentally gets selected.
docker("run", "--rm", "--network", "none", image, "node", "-e", runtimeCheck);
const id = docker(
  "run",
  "-d",
  "--network",
  "none",
  ...config.env.flatMap((value) => ["-e", value]),
  image,
).trim();
try {
  const requestCheck = `
import assert from 'node:assert/strict';
import { request } from 'node:http';
const paths = ${JSON.stringify(config.paths)};
for (const [path, status, headers = {}, method = 'GET'] of paths) {
  let response;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      response = await new Promise((resolve, reject) => {
        const req = request('http://127.0.0.1:${config.port}' + path, {headers, method}, async res => {
          let body = '';
          for await (const chunk of res) body += chunk;
          resolve({status: res.statusCode, body});
        });
        req.on('error', reject);
        req.end();
      });
      break;
    } catch (error) { if (attempt === 59) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.equal(response.status, status, path + ': ' + response.body);
  console.log(method + ' ' + path + ' ' + status);
}
`;
  docker("exec", id, "node", "--input-type=module", "-e", requestCheck);
  if (["artbin", "letters-to-steve"].includes(app)) {
    docker(
      "exec",
      id,
      "node",
      "--input-type=module",
      "-e",
      `
      import assert from 'node:assert/strict';
      import sharp from 'sharp';
      const bytes = await sharp({create: {width: 2, height: 2, channels: 3, background: '#abcdef'}}).webp().toBuffer();
      assert.equal((await sharp(bytes).metadata()).format, 'webp');
      console.log('sharp WebP encode/decode passed');
    `,
    );
  }
  if (app === "artbin") {
    docker("exec", id, "convert", "-version");
    docker("exec", id, "identify", "-version");
    docker(
      "exec",
      id,
      "node",
      "--input-type=module",
      "-e",
      `
      import assert from 'node:assert/strict';
      import { chromium } from 'playwright';
      const browser = await chromium.launch({channel: 'chromium'});
      try {
        const page = await browser.newPage();
        await page.setContent('<title>Tea image smoke</title>');
        assert.equal(await page.title(), 'Tea image smoke');
        console.log('Chromium launch/render passed');
      } finally { await browser.close(); }
    `,
    );
  }
  const databases = {
    cms: ["/app/data/andrew/tea.db", "/app/data/luke/tea.db"],
    "letters-to-steve": ["/app/data/letters.sqlite"],
    "maps-service": ["/app/data/maps.db"],
  };
  for (const path of databases[app] ?? []) {
    docker(
      "exec",
      id,
      "node",
      "-e",
      `
      const assert = require('node:assert/strict');
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(path)});
      assert.ok(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get().count > 5);
      db.exec("CREATE TABLE smoke(value TEXT); INSERT INTO smoke VALUES ('persisted')");
      db.close();
      const reopened = new DatabaseSync(${JSON.stringify(path)});
      assert.equal(reopened.prepare('SELECT value FROM smoke').get().value, 'persisted');
      reopened.close();
      console.log('migrated database write/reopen passed: ' + ${JSON.stringify(path)});
    `,
    );
  }
  if (["artbin", "cms", "maps-service", "maps-compiler"].includes(app)) {
    docker(
      "exec",
      id,
      "node",
      "--input-type=module",
      "-e",
      `
      import assert from 'node:assert/strict';
      import Database from 'better-sqlite3';
      import { createRequire } from 'node:module';
      import { existsSync } from 'node:fs';
      const require = createRequire(import.meta.url);
      assert.equal(existsSync('/app/node_modules/better-sqlite3/prebuilds'), false);
      const path = ${JSON.stringify(app === "artbin" ? "data/artbin.db" : "/tmp/native-smoke.db")};
      const db = new Database(path);
      if (${JSON.stringify(app)} === 'artbin') assert.ok(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get().count > 5);
      assert.ok(Object.keys(require.cache).some(path => path.endsWith('/build/Release/better_sqlite3.node')));
      db.exec('CREATE TABLE smoke(value TEXT)');
      db.prepare('INSERT INTO smoke VALUES (?)').run('compression-safe');
      assert.equal(db.prepare('SELECT value FROM smoke').get().value, 'compression-safe');
      db.close();
      const reopened = new Database(path);
      assert.equal(reopened.prepare('SELECT value FROM smoke').get().value, 'compression-safe');
      reopened.close();
      console.log('rebuilt better-sqlite3 write/reopen passed');
    `,
    );
  }
  console.log(`${app}: runtime, startup and request checks passed`);
} catch (error) {
  console.error(docker("logs", id));
  throw error;
} finally {
  docker("rm", "-f", id);
}
