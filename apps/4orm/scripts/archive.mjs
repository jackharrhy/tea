import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const digest = (value) => createHash("sha256").update(value).digest("hex");
function metadata(value) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([table, rows]) => [
          table,
          rows
            .map((row) =>
              Object.fromEntries(
                Object.entries(row).toSorted(([a], [b]) => a.localeCompare(b)),
              ),
            )
            .toSorted((a, b) =>
              JSON.stringify(a).localeCompare(JSON.stringify(b)),
            ),
        ]),
    ),
  );
}
export async function transferArchive({ mode, directory, origin, token }) {
  if (!["backup", "restore"].includes(mode))
    throw new Error("Use backup or restore");
  const base = new URL(origin);
  if (
    base.origin !== origin ||
    (base.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
  )
    throw new Error("Use an exact HTTPS origin or isolated loopback instance");
  const headers = { Authorization: `Bearer ${token}` };
  const request = async (path, options = {}) => {
    const response = await fetch(origin + path, {
      ...options,
      headers: { ...headers, ...options.headers },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`Archive request failed (${response.status}): ${path}`);
    return response;
  };
  if (mode === "backup") {
    await mkdir(directory, { mode: 0o700 });
    await mkdir(join(directory, "objects"), { mode: 0o700 });
    const before = await (await request("/api/archive")).json();
    const objects = [];
    for (const item of before.tables.media) {
      const path =
        "/uploads/" +
        item.storage_path.split("/").map(encodeURIComponent).join("/");
      const response = await request(path);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== item.size_bytes)
        throw new Error("Media size changed during backup");
      const sha256 = digest(bytes),
        file = `objects/${sha256}`;
      await writeFile(join(directory, file), bytes, { mode: 0o600 });
      objects.push({
        storage_path: item.storage_path,
        sha256,
        size_bytes: bytes.length,
        ...before.objects?.find(
          (object) => object.storage_path === item.storage_path,
        ),
        mime_type: item.mime_type,
        content_type: response.headers.get("Content-Type"),
        last_modified: response.headers.get("Last-Modified"),
        etag: response.headers.get("ETag"),
        file,
      });
    }
    const after = await (await request("/api/archive")).json();
    if (
      metadata(before.tables) !== metadata(after.tables) ||
      JSON.stringify(before.objects) !== JSON.stringify(after.objects)
    )
      throw new Error(
        "Community changed during backup; retry into a fresh directory",
      );
    await writeFile(
      join(directory, "archive.json"),
      JSON.stringify({ ...before, objects }),
      { mode: 0o600, flag: "wx" },
    );
    return {
      status: "PASS",
      mode,
      tables: Object.keys(before.tables).length,
      media: objects.length,
    };
  }
  const archive = JSON.parse(
    await readFile(join(directory, "archive.json"), "utf8"),
  );
  if (
    archive.version !== 1 ||
    !archive.tables ||
    !Array.isArray(archive.objects)
  )
    throw new Error("Unsupported archive");
  const verified = [];
  for (const item of archive.objects) {
    if (
      item.file !== `objects/${item.sha256}` ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      throw new Error("Invalid archive file reference");
    const bytes = await readFile(join(directory, item.file));
    if (digest(bytes) !== item.sha256 || bytes.length !== item.size_bytes)
      throw new Error("Archive media verification failed");
    verified.push(item);
  }
  for (const item of verified) {
    const bytes = await readFile(join(directory, item.file));
    if (digest(bytes) !== item.sha256)
      throw new Error("Archive changed after validation");
    await request(
      "/api/archive/media/" +
        item.storage_path.split("/").map(encodeURIComponent).join("/"),
      {
        method: "PUT",
        headers: {
          "Content-Type": item.mime_type,
          "X-Content-SHA256": item.sha256,
          ...(item.last_modified
            ? { "X-Source-Last-Modified": item.last_modified }
            : {}),
          ...(item.etag ? { "X-Source-ETag": item.etag } : {}),
          ...(item.mtime_ns ? { "X-Source-Mtime-Ns": item.mtime_ns } : {}),
        },
        body: bytes,
      },
    );
  }
  await request("/api/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(archive),
  });
  const result = await (await request("/api/archive")).json();
  if (metadata(result.tables) !== metadata(archive.tables))
    throw new Error("Restored ownership, IDs or data differ from the archive");
  for (const item of verified) {
    const response = await request(
      "/uploads/" +
        item.storage_path.split("/").map(encodeURIComponent).join("/"),
    );
    if (digest(Buffer.from(await response.arrayBuffer())) !== item.sha256)
      throw new Error("Restored object readback differs");
    for (const [field, header] of [
      ["last_modified", "Last-Modified"],
      ["etag", "ETag"],
      ["content_type", "Content-Type"],
    ])
      if (item[field] && item[field] !== response.headers.get(header))
        throw new Error("Restored object response metadata differs");
  }
  return {
    status: "PASS",
    mode,
    tables: Object.keys(archive.tables).length,
    media: verified.length,
    idsAndOwnershipPreserved: true,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [mode, directory] = process.argv.slice(2);
  const origin = process.env.FOURM_URL;
  const file = process.env.FOURM_ACCESS_TOKEN_FILE;
  if (!mode || !directory || !origin || !file)
    throw new Error(
      "Use FOURM_URL and a private FOURM_ACCESS_TOKEN_FILE with: node scripts/archive.mjs backup|restore DIRECTORY",
    );
  process.umask(0o077);
  console.log(
    JSON.stringify(
      await transferArchive({
        mode,
        directory: resolve(directory),
        origin,
        token: (await readFile(file, "utf8")).trim(),
      }),
    ),
  );
}
