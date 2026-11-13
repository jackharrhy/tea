import assert from "node:assert/strict";
import { createServer as httpServer, request as httpRequest } from "node:http";
import { createServer as httpsServer } from "node:https";
import { connect } from "node:net";

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

// Private test transport: the public issuer name is never resolved or dialed.
export async function cliIssuerProxy({ key, cert, upstream }) {
  const target = new URL(upstream);
  assert.equal(target.protocol, "http:");
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/");
  assert.equal(target.search, "");
  assert.equal(target.username, "");
  assert.equal(target.password, "");
  assert.equal(target.hash, "");
  const sockets = new Set();
  const counts = { tunnels: 0, requests: 0, denied: 0 };
  const tls = httpsServer({ key, cert }, (req, res) => {
    if (
      req.headers.host !== "auth.jackharrhy.dev" ||
      !req.url.startsWith("/") ||
      req.url.startsWith("//")
    ) {
      counts.denied++;
      res.writeHead(403).end();
      return;
    }
    counts.requests++;
    const forwarded = httpRequest(
      {
        hostname: "127.0.0.1",
        port: target.port || 80,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: "auth.jackharrhy.dev" },
      },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
      },
    );
    forwarded.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.on("aborted", () => forwarded.destroy());
    res.on("close", () => forwarded.destroy());
    req.pipe(forwarded);
  });
  const proxy = httpServer((req, res) => {
    counts.denied++;
    res.writeHead(403).end();
  });
  for (const server of [tls, proxy])
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.setTimeout(30000, () => socket.destroy());
    });
  proxy.on("connect", (req, client, head) => {
    if (req.url !== "auth.jackharrhy.dev:443") {
      counts.denied++;
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    counts.tunnels++;
    const local = connect(
      { host: "127.0.0.1", port: tls.address().port },
      () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) local.write(head);
        client.pipe(local);
        local.pipe(client);
      },
    );
    sockets.add(local);
    local.once("close", () => {
      sockets.delete(local);
      client.destroy();
    });
    client.once("close", () => local.destroy());
    client.on("error", () => local.destroy());
    local.on("error", () => client.destroy());
  });
  try {
    await listen(tls);
    await listen(proxy);
  } catch (error) {
    tls.close();
    proxy.close();
    throw error;
  }
  return {
    url: `http://127.0.0.1:${proxy.address().port}`,
    counts,
    async close() {
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        [tls, proxy].map(
          (server) => new Promise((resolve) => server.close(resolve)),
        ),
      );
    },
  };
}
