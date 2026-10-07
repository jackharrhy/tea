import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
export const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function validateArchive(manifest, directory) {
  assert.equal(manifest.format, "ref-archive");
  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.boards));
  const boardIds = new Set();
  for (const board of manifest.boards) {
    const { record, items, assets, links, previews } = board;
    assert.ok(uuid.test(record.id) && !boardIds.has(record.id));
    boardIds.add(record.id);
    assert.ok(
      typeof record.title === "string" &&
        record.title.trim() === record.title &&
        record.title.length > 0 &&
        record.title.length <= 100,
    );
    assert.ok(Number.isSafeInteger(record.createdAt) && record.createdAt > 0);
    assert.ok(
      Number.isSafeInteger(record.updatedAt) &&
        record.updatedAt >= record.createdAt,
    );
    assert.ok(Array.isArray(items) && items.length <= 2_000);
    assert.ok(
      Array.isArray(assets) && Array.isArray(links) && Array.isArray(previews),
    );
    const assetIds = new Set();
    for (const asset of assets) {
      assert.ok(uuid.test(asset.id) && !assetIds.has(asset.id));
      assetIds.add(asset.id);
      assert.ok(
        typeof asset.filename === "string" &&
          asset.filename.length > 0 &&
          asset.filename.length <= 160 &&
          !/[\0/\\]/.test(asset.filename),
      );
      await validateFile(
        directory,
        `assets/${record.id}/${asset.id}`,
        asset,
        20 * 1024 * 1024,
      );
    }
    const linkIds = new Set();
    for (const link of links) {
      assert.ok(uuid.test(link.assetId) && !assetIds.has(link.assetId));
      assetIds.add(link.assetId);
      linkIds.add(link.assetId);
      assert.ok(validLink(link.preview, record.id));
    }
    const previewIds = new Set();
    for (const preview of previews) {
      assert.ok(hash.test(preview.id) && !previewIds.has(preview.id));
      previewIds.add(preview.id);
      await validateFile(
        directory,
        `previews/${record.id}/${preview.id}`,
        preview,
        5 * 1024 * 1024,
      );
    }
    const itemIds = new Set();
    for (const item of items) {
      assert.ok(
        uuid.test(item.id) &&
          !itemIds.has(item.id) &&
          assetIds.has(item.assetId),
      );
      itemIds.add(item.id);
      for (const number of ["x", "y", "width", "height", "rotation", "z"])
        assert.ok(
          Number.isFinite(item[number]) && Math.abs(item[number]) <= 1_000_000,
        );
      assert.ok(
        item.width >= 24 &&
          item.width <= 20_000 &&
          item.height >= 24 &&
          item.height <= 20_000,
      );
      assert.ok(Number.isInteger(item.z) && Math.abs(item.rotation) <= 360_000);
      if (item.link) {
        assert.ok(linkIds.has(item.assetId));
        const link = links.find(({ assetId }) => assetId === item.assetId);
        assert.deepEqual(item.link, link?.preview);
        const match = new RegExp(
          `^/previews/${record.id}/([0-9a-f]{64})$`,
        ).exec(item.link.imageUrl ?? "");
        if (match) assert.ok(previewIds.has(match[1]));
      } else assert.ok(!linkIds.has(item.assetId));
    }
  }
}

function validLink(preview, boardId) {
  if (
    !preview ||
    !validUrl(preview.url) ||
    typeof preview.title !== "string" ||
    preview.title.length < 1 ||
    preview.title.length > 200 ||
    typeof preview.description !== "string" ||
    preview.description.length > 700 ||
    typeof preview.siteName !== "string" ||
    preview.siteName.length > 100
  )
    return false;
  return (
    preview.imageUrl === null ||
    validUrl(preview.imageUrl) ||
    new RegExp(`^/previews/${boardId}/[0-9a-f]{64}$`).test(preview.imageUrl)
  );
}

function validUrl(value) {
  if (typeof value !== "string" || !value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      url.href === value &&
      host.includes(".") &&
      !host.startsWith("[") &&
      !/^\d+(?:\.\d+){3}$/.test(host) &&
      !/(?:^|\.)(?:localhost|local|internal|lan|test|invalid|onion)$/.test(host)
    );
  } catch {
    return false;
  }
}

async function validateFile(directory, filename, entry, limit) {
  assert.ok(imageTypes.has(entry.contentType));
  assert.ok(
    Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= limit,
  );
  assert.ok(hash.test(entry.sha256));
  const bytes = await readFile(join(directory, filename));
  assert.equal(bytes.length, entry.size);
  assert.equal(digest(bytes), entry.sha256);
}
