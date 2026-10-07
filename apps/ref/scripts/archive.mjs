import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { digest, imageTypes, validateArchive } from "./archive-format.mjs";

const command = process.argv[2];
const directory = process.argv[3] ? resolve(process.argv[3]) : null;
const base = new URL(process.env.REF_URL ?? "http://localhost:8787");
const password = process.env.REF_PASSWORD;

if (!["backup", "restore"].includes(command) || !directory || !password) {
  throw new Error(
    "Usage: REF_URL=https://host REF_PASSWORD=... npm run backup|restore -- /archive/directory",
  );
}
if (!["http:", "https:"].includes(base.protocol))
  throw new Error("REF_URL must use HTTP or HTTPS");
if (
  base.protocol === "http:" &&
  !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
) {
  throw new Error("Use HTTPS for a remote REF_URL");
}

const session = await login();
if (command === "backup") await backup();
else await restore();

async function login() {
  const response = await fetch(new URL("/login", base), {
    method: "POST",
    body: new URLSearchParams({ password }),
    redirect: "manual",
  });
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (response.status !== 303 || !cookie) throw new Error("Login failed");
  const check = await fetch(new URL("/api/archive/boards", base), {
    headers: { Cookie: cookie },
  });
  if (!check.ok) throw new Error("Login failed");
  return cookie;
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", session);
  const response = await fetch(new URL(path, base), {
    ...init,
    headers,
    redirect: "manual",
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${response.status} ${detail}`,
    );
  }
  return response;
}

async function json(path) {
  return (await request(path)).json();
}

async function download(path, filename, target) {
  const response = await request(path);
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type");
  if (!imageTypes.has(contentType) || bytes.length === 0)
    throw new Error(`Invalid image: ${path}`);
  await mkdir(dirname(join(target, filename)), { recursive: true });
  await writeFile(join(target, filename), bytes);
  return { contentType, size: bytes.length, sha256: digest(bytes) };
}

async function backup() {
  try {
    await access(directory);
    throw new Error(`Archive directory already exists: ${directory}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(directory), { recursive: true });
  const temporary = await mkdtemp(join(dirname(directory), ".ref-archive-"));
  try {
    const boards = await json("/api/archive/boards");
    const manifest = {
      format: "ref-archive",
      version: 1,
      createdAt: new Date().toISOString(),
      boards: [],
    };
    for (const record of boards) {
      const { id } = record;
      const snapshot = await json(`/api/boards/${id}/snapshot`);
      const assets = new Map();
      const links = new Map();
      const previews = new Map();
      for (const item of snapshot.items) {
        if (item.link) {
          links.set(item.assetId, {
            assetId: item.assetId,
            preview: item.link,
          });
          const match = new RegExp(`^/previews/${id}/([0-9a-f]{64})$`).exec(
            item.link.imageUrl ?? "",
          );
          if (match) previews.set(match[1], null);
        } else {
          assets.set(item.assetId, {
            id: item.assetId,
            filename: item.filename,
          });
        }
      }
      for (const asset of assets.values()) {
        Object.assign(
          asset,
          await download(
            `/media/${id}/${asset.id}`,
            `assets/${id}/${asset.id}`,
            temporary,
          ),
        );
      }
      for (const imageId of previews.keys()) {
        previews.set(imageId, {
          id: imageId,
          ...(await download(
            `/previews/${id}/${imageId}`,
            `previews/${id}/${imageId}`,
            temporary,
          )),
        });
      }
      const after = await json(`/api/boards/${id}/snapshot`);
      if (JSON.stringify(snapshot) !== JSON.stringify(after))
        throw new Error(`Board changed during backup: ${id}. Try again.`);
      manifest.boards.push({
        record,
        items: snapshot.items,
        assets: [...assets.values()],
        links: [...links.values()],
        previews: [...previews.values()],
      });
      console.log(`Saved ${record.title}: ${snapshot.items.length} items`);
    }
    if (
      JSON.stringify(boards) !==
      JSON.stringify(await json("/api/archive/boards"))
    )
      throw new Error("Board list changed during backup. Try again.");
    await writeFile(
      join(temporary, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await rename(temporary, directory);
    console.log(`Backup complete: ${directory}`);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function restore() {
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  await validateArchive(manifest, directory);
  const existing = await json("/api/archive/boards");
  const expected = new Map(
    manifest.boards.map(({ record }) => [record.id, record]),
  );
  const archivedItems = new Map(
    manifest.boards.map(({ record, items }) => [
      record.id,
      new Map(items.map((item) => [item.id, item])),
    ]),
  );
  const alreadyPresent = new Map();
  for (const board of existing) {
    assert.deepEqual(
      board,
      expected.get(board.id),
      `Unexpected board in restore target: ${board.id}`,
    );
    const snapshot = await json(`/api/boards/${board.id}/snapshot`);
    const present = new Set();
    for (const item of snapshot.items) {
      assertVisualItem(
        item,
        archivedItems.get(board.id).get(item.id),
        `Existing item conflicts with backup: ${item.id}`,
      );
      present.add(item.id);
    }
    alreadyPresent.set(board.id, present);
  }
  for (const board of manifest.boards) {
    const { record, items, assets, links, previews } = board;
    const { id } = record;
    await post(`/api/archive/boards`, "record", record);
    for (const asset of assets) {
      await upload(
        `/api/archive/boards/${id}/assets/${asset.id}`,
        `assets/${id}/${asset.id}`,
        asset,
      );
    }
    for (const preview of previews) {
      await upload(
        `/api/archive/boards/${id}/previews/${preview.id}`,
        `previews/${id}/${preview.id}`,
        preview,
      );
    }
    for (const link of links) {
      await post(
        `/api/archive/boards/${id}/links/${link.assetId}`,
        "preview",
        link.preview,
      );
    }
    for (const item of items) {
      if (alreadyPresent.get(id)?.has(item.id)) continue;
      await post(`/api/archive/boards/${id}/items`, "operation", {
        kind: "create",
        operationId: item.id,
        item: {
          id: item.id,
          assetId: item.assetId,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          rotation: item.rotation,
          z: item.z,
        },
      });
    }
    const restored = await json(`/api/boards/${id}/snapshot`);
    const actualItems = restored.items.toSorted((a, b) =>
      a.id.localeCompare(b.id),
    );
    const expectedItems = items.toSorted((a, b) => a.id.localeCompare(b.id));
    assert.equal(
      actualItems.length,
      expectedItems.length,
      `Board did not restore: ${id}`,
    );
    for (let index = 0; index < actualItems.length; index += 1) {
      assertVisualItem(
        actualItems[index],
        expectedItems[index],
        `Board did not restore: ${id}, item ${expectedItems[index].id}`,
      );
    }
    for (const asset of assets) {
      const response = await request(`/media/${id}/${asset.id}`);
      assert.equal(
        digest(Buffer.from(await response.arrayBuffer())),
        asset.sha256,
      );
    }
    for (const preview of previews) {
      const response = await request(`/previews/${id}/${preview.id}`);
      assert.equal(
        digest(Buffer.from(await response.arrayBuffer())),
        preview.sha256,
      );
    }
    console.log(`Restored ${record.title}: ${items.length} items`);
  }
  assert.deepEqual(
    (await json("/api/archive/boards")).toSorted((a, b) =>
      a.id.localeCompare(b.id),
    ),
    manifest.boards
      .map(({ record }) => record)
      .toSorted((a, b) => a.id.localeCompare(b.id)),
  );
  console.log("Restore verified");
}

function visualItem(item) {
  if (!item) return null;
  const visual = { ...item };
  delete visual.revision;
  return visual;
}

function assertVisualItem(actual, expected, message) {
  const observed = visualItem(actual);
  const archived = visualItem(expected);
  assert.ok(observed && archived, message);
  for (const field of ["x", "y", "width", "height", "rotation"]) {
    assert.ok(
      Number.isFinite(observed[field]) &&
        Number.isFinite(archived[field]) &&
        Math.abs(observed[field] - archived[field]) <= 1e-9,
      `${message}: ${field} differs`,
    );
    observed[field] = archived[field];
  }
  assert.deepEqual(observed, archived, message);
}

async function post(path, key, value) {
  const form = new FormData();
  form.set(key, JSON.stringify(value));
  await request(path, { method: "POST", body: form });
}

async function upload(path, filename, entry) {
  const bytes = await readFile(join(directory, filename));
  const form = new FormData();
  form.set(
    "file",
    new File([bytes], entry.filename ?? entry.id, { type: entry.contentType }),
  );
  await request(path, { method: "POST", body: form });
}
