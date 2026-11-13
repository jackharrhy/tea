import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, request } from "node:http";
import { connect as tlsConnect } from "node:tls";
import { cliIssuerProxy } from "./cli-issuer-proxy.mjs";

test("CLI issuer cage requires trusted TLS and refuses every other destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fourm-cli-cage-"));
  let proxy;
  const upstream = createServer((req, res) => {
    assert.equal(req.url, "/fixture-proof");
    res.end("isolated-issuer-proof");
  });
  try {
    const key = join(directory, "key.pem"),
      cert = join(directory, "cert.pem");
    assert.equal(
      spawnSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          key,
          "-out",
          cert,
          "-days",
          "1",
          "-subj",
          "/CN=auth.jackharrhy.dev",
          "-addext",
          "subjectAltName=DNS:auth.jackharrhy.dev",
        ],
        { stdio: "ignore" },
      ).status,
      0,
    );
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    proxy = await cliIssuerProxy({
      key: await readFile(key),
      cert: await readFile(cert),
      upstream: `http://127.0.0.1:${upstream.address().port}`,
    });
    const tunnel = (destination) =>
      new Promise((resolve, reject) => {
        const req = request(proxy.url, {
          method: "CONNECT",
          path: destination,
        });
        req.once("connect", (response, socket, head) =>
          resolve({ response, socket, head }),
        );
        req.once("error", reject);
        req.end();
      });
    for (const destination of [
      "example.com:443",
      "auth.jackharrhy.dev:444",
      "auth.jackharrhy.dev.evil:443",
      "127.0.0.1:22",
    ]) {
      const { response, socket } = await tunnel(destination);
      assert.equal(response.statusCode, 403);
      socket.destroy();
    }
    const deniedHTTP = await new Promise((resolve, reject) => {
      const req = request(
        proxy.url,
        { path: "http://example.com/", method: "GET" },
        resolve,
      );
      req.once("error", reject);
      req.end();
    });
    assert.equal(deniedHTTP.statusCode, 403);
    deniedHTTP.resume();
    const untrusted = await tunnel("auth.jackharrhy.dev:443");
    assert.equal(untrusted.response.statusCode, 200);
    await new Promise((resolve, reject) => {
      const secure = tlsConnect({
        socket: untrusted.socket,
        servername: "auth.jackharrhy.dev",
      });
      secure.once("secureConnect", () => {
        secure.destroy();
        reject(new Error("Fixture CA unexpectedly trusted globally"));
      });
      secure.once("error", (error) => {
        assert.equal(error.code, "DEPTH_ZERO_SELF_SIGNED_CERT");
        secure.destroy();
        resolve();
      });
    });
    const trusted = await tunnel("auth.jackharrhy.dev:443");
    const scopedCA = await readFile(cert);
    const text = await new Promise((resolve, reject) => {
      const secure = tlsConnect({
        socket: trusted.socket,
        servername: "auth.jackharrhy.dev",
        ca: scopedCA,
      });
      secure.on("error", reject);
      let response = "";
      secure.once("secureConnect", () =>
        secure.write(
          "GET /fixture-proof HTTP/1.1\r\nHost: auth.jackharrhy.dev\r\nConnection: close\r\n\r\n",
        ),
      );
      secure.on("data", (part) => (response += part));
      secure.once("end", () => resolve(response));
    });
    assert.match(text, /HTTP\/1.1 200/);
    assert.ok(text.endsWith("isolated-issuer-proof"));
    assert.equal(proxy.counts.requests, 1);
    assert.equal(proxy.counts.denied, 5);
  } finally {
    if (proxy) await proxy.close();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
