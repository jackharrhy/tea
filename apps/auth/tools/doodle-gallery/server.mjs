import http from "node:http";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { defaultPool, validPool, validSettings } from "../../src/doodles.mjs";
const root = dirname(fileURLToPath(import.meta.url));
const host = process.env.GALLERY_HOST || "100.123.66.70",
  port = Number(process.env.GALLERY_PORT || 18794);
const poolFile =
  process.env.GALLERY_POOL_FILE ||
  "/mnt/terrabud/docker-data/newport/jack-auth/ui/doodle-pool.json";
const allowedHosts = [
  `${host}:${port}`,
  `newport:${port}`,
  `newport.hedgehog-python.ts.net:${port}`,
];
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/gallery.mjs", ["gallery.mjs", "text/javascript; charset=utf-8"]],
  ["/gallery.css", ["gallery.css", "text/css; charset=utf-8"]],
]);
async function pool() {
  try {
    const value = JSON.parse(await readFile(poolFile, "utf8"));
    if (!validPool(value.enabled) || !Number.isSafeInteger(value.revision))
      throw Error("Invalid saved pool");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return { revision: 0, enabled: defaultPool };
    throw error;
  }
}
let writes = Promise.resolve();
http
  .createServer(async (request, response) => {
    const reply = (status, value, type = "application/json") => {
      response.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self' blob:; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      });
      response.end(
        typeof value === "string" || Buffer.isBuffer(value)
          ? value
          : JSON.stringify(value),
      );
    };
    if (!allowedHosts.includes(request.headers.host))
      return reply(403, { error: "Unknown host" });
    const pathname = new URL(request.url, `http://${request.headers.host}`)
      .pathname;
    try {
      if (pathname === "/api/pool" && request.method === "GET")
        return reply(200, await pool());
      if (pathname === "/api/pool" && request.method === "PATCH") {
        if (
          request.headers.origin !== `http://${request.headers.host}` ||
          !request.headers["content-type"]?.startsWith("application/json")
        )
          return reply(403, { error: "Open the gallery to save." });
        let body = "";
        for await (const part of request) {
          body += part;
          if (Buffer.byteLength(body) > 16000)
            return reply(413, { error: "Too large" });
        }
        let input;
        try {
          input = JSON.parse(body);
        } catch {
          return reply(400, { error: "Invalid pool" });
        }
        if (
          !validPool(input.enabled) ||
          !Number.isSafeInteger(input.expectedRevision) ||
          (input.settings !== undefined && !validSettings(input.settings))
        )
          return reply(400, { error: "Choose at least one background." });
        const result = writes.then(async () => {
          const current = await pool();
          if (current.revision !== input.expectedRevision)
            return { conflict: true };
          const next = {
            schema: 1,
            revision: current.revision + 1,
            enabled: input.enabled,
            settings: input.settings ?? current.settings ?? {},
            updatedAt: new Date().toISOString(),
          };
          await mkdir(dirname(poolFile), { recursive: true, mode: 0o700 });
          const tmp = poolFile + "." + randomUUID() + ".tmp";
          await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", {
            mode: 0o600,
            flag: "wx",
          });
          await rename(tmp, poolFile);
          return next;
        });
        writes = result.catch(() => {});
        const value = await result;
        return reply(
          value.conflict ? 409 : 200,
          value.conflict
            ? { error: "Pool changed in another tab. Reload first." }
            : value,
        );
      }
      if (request.method !== "GET")
        return reply(405, { error: "Method not allowed" });
      if (pathname === "/doodles.mjs" || pathname === "/doodle-spec.mjs")
        return reply(
          200,
          await readFile(join(root, "../../src/doodles.mjs")),
          "text/javascript; charset=utf-8",
        );
      if (pathname === "/doodle-webgl.mjs")
        return reply(
          200,
          await readFile(join(root, "../../public/doodle-webgl.mjs")),
          "text/javascript; charset=utf-8",
        );
      if (pathname === "/inter.woff2")
        return reply(
          200,
          await readFile(join(root, "../../public/fonts/inter-variable.woff2")),
          "font/woff2",
        );
      if (!files.has(pathname)) return reply(404, { error: "Not found" });
      const [file, type] = files.get(pathname);
      return reply(200, await readFile(join(root, "public", file)), type);
    } catch {
      reply(500, {
        error: "Could not load or save. Your choices stay in this tab.",
      });
    }
  })
  .listen(port, host, () =>
    console.log(`Doodle gallery listening on ${host}:${port}`),
  );
