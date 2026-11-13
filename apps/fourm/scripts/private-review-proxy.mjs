import { createServer, request } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { attestCounterPeer, counterPeerHeader } from "../app/counter-peer.ts";
import { readFile } from "node:fs/promises";
const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const key = (await readFile(config.keyFile, "utf8")).trim();
if (!/^[a-f0-9]{64}$/.test(key))
  throw new Error("Private review requires its own random access key");
const equal = (value) => {
  const a = createHash("sha256").update(value).digest();
  const b = createHash("sha256").update(key).digest();
  return timingSafeEqual(a, b);
};
const counterKey = config.counterPeerKeyFile
  ? (await readFile(config.counterPeerKeyFile, "utf8")).trim()
  : null;
if (counterKey !== null && !/^[a-f0-9]{64}$/.test(counterKey))
  throw new Error("Invalid private counter key");
const servers = [];
const sockets = new Set();
for (const route of config.routes) {
  const upstream = new URL(route.upstream);
  if (
    upstream.hostname !== "127.0.0.1" ||
    upstream.protocol !== "http:" ||
    upstream.pathname !== "/"
  )
    throw new Error("Only fixed loopback upstreams allowed");
  const server = createServer(async (req, res) => {
    const headers = {
      "Cache-Control": "no-store",
      "Referrer-Policy": "same-origin",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    };
    const url = new URL(req.url, route.origin);
    const cookies = (req.headers.cookie ?? "").split(";").map((x) => x.trim());
    const cookie =
      cookies
        .find((x) => x.startsWith("fourm_review_access="))
        ?.slice("fourm_review_access=".length) ?? "";
    if (req.method === "POST" && url.pathname === "/_review/access") {
      if (req.headers.origin !== route.origin) {
        res.writeHead(403, headers).end();
        return;
      }
      let body = "";
      for await (const part of req) {
        body += part;
        if (body.length > 1024) {
          res.writeHead(413, headers).end();
          return;
        }
      }
      if (equal(new URLSearchParams(body).get("key") ?? "")) {
        res
          .writeHead(303, {
            ...headers,
            Location: "/",
            "Set-Cookie": `fourm_review_access=${key}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,
          })
          .end();
        return;
      }
    }
    const identity = req.headers["tailscale-user-login"];
    const owner =
      typeof identity === "string" &&
      config.ownerLoginSha256 &&
      createHash("sha256").update(identity).digest("hex") ===
        config.ownerLoginSha256;
    if (!owner && !equal(cookie)) {
      res.writeHead(401, {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; form-action 'self'",
      });
      res.end(
        '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private 4orm review</title><h1>Private 4orm review</h1><p>This isolated work-in-progress copy contains real content. Enter the separate review key.</p><form method="post" action="/_review/access"><label>Review key <input type="password" name="key" required autocomplete="off"></label><button>Open review</button></form>',
      );
      return;
    }
    const asset = config.localAssets?.[url.pathname];
    if (asset && req.method === "GET") {
      const bytes = await readFile(asset);
      res
        .writeHead(200, {
          ...headers,
          "Content-Type": "text/javascript; charset=utf-8",
          "Content-Length": bytes.length,
        })
        .end(bytes);
      return;
    }
    const forwardedHeaders = { ...req.headers };
    delete forwardedHeaders.cookie;
    delete forwardedHeaders.host;
    delete forwardedHeaders[counterPeerHeader];
    if (counterKey && /^\/u\/[^/]+\/counter\/?$/.test(url.pathname)) {
      const peer = req.headers["x-forwarded-for"];
      if (typeof peer === "string" && isIP(peer))
        forwardedHeaders[counterPeerHeader] = await attestCounterPeer(
          { ip: peer, method: req.method, path: url.pathname, at: Date.now() },
          counterKey,
        );
    }
    const otherCookies = cookies.filter(
      (x) => !x.startsWith("fourm_review_access="),
    );
    if (otherCookies.length) forwardedHeaders.cookie = otherCookies.join("; ");
    const forwarded = request(
      {
        hostname: "127.0.0.1",
        port: upstream.port,
        path: url.pathname + url.search,
        method: req.method,
        headers: forwardedHeaders,
      },
      (reply) => {
        const csp = `default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; frame-src 'self' data: blob:; form-action 'self' ${config.routes.map((r) => r.origin).join(" ")}; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`;
        const responseHeaders = {
          ...reply.headers,
          ...headers,
          "Content-Security-Policy": csp,
        };
        if ((reply.headers["content-type"] ?? "").startsWith("text/html")) {
          const chunks = [];
          let size = 0;
          reply.on("data", (chunk) => {
            size += chunk.length;
            if (size > 4 * 1024 * 1024) {
              reply.destroy();
              res.destroy();
              return;
            }
            chunks.push(chunk);
          });
          reply.on("end", () => {
            let html = Buffer.concat(chunks).toString("utf8");
            for (const [from, to] of Object.entries(config.rewrites ?? {}))
              html = html.replaceAll(from, to);
            const bytes = Buffer.from(html);
            delete responseHeaders["transfer-encoding"];
            delete responseHeaders.etag;
            delete responseHeaders["last-modified"];
            responseHeaders["content-length"] = bytes.length;
            res.writeHead(reply.statusCode, responseHeaders).end(bytes);
          });
        } else {
          res.writeHead(reply.statusCode, responseHeaders);
          reply.pipe(res);
        }
      },
    );
    forwarded.on("error", () => {
      if (!res.headersSent) res.writeHead(502, headers);
      res.end();
    });
    req.on("aborted", () => forwarded.destroy());
    res.on("close", () => forwarded.destroy());
    req.pipe(forwarded);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(route.port, "127.0.0.1", resolve);
  });
  servers.push(server);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const socket of sockets) socket.destroy();
    Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(resolve))),
    ).then(() => process.exit(0));
  });
console.log(
  "Private review proxy ready; both app and issuer require review access",
);
