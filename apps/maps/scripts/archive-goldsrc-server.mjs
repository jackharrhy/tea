import { createSocket } from "node:dgram";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_FILE_BYTES = 128 * 1024 * 1024;

function usage() {
  throw new Error(
    "Usage: node scripts/archive-goldsrc-server.mjs <host:port> <fastdl-base-url> [fixture-name]",
  );
}

function serverAddress(value) {
  const match = /^([^:]+):(\d{1,5})$/.exec(value);
  if (!match || Number(match[2]) > 65535 || Number(match[2]) === 0) usage();
  return { host: match[1], port: Number(match[2]) };
}

function readCString(bytes, offset) {
  const end = bytes.indexOf(0, offset);
  if (end < 0) throw new Error("Incomplete game server response");
  return [bytes.toString("utf8", offset, end), end + 1];
}

async function queryMap({ host, port }) {
  const socket = createSocket("udp4");
  try {
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Game server query timed out")),
        5000,
      );
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      socket.once("message", (bytes) => {
        clearTimeout(timeout);
        resolve(bytes);
      });
    });
    socket.send(
      Buffer.concat([
        Buffer.alloc(4, 255),
        Buffer.from("TSource Engine Query\0"),
      ]),
      port,
      host,
    );
    const bytes = await response;
    if (bytes.readInt32LE(0) !== -1)
      throw new Error("Unsupported server response");
    let offset = 5;
    if (bytes[4] === 0x49) offset++; // A2S_INFO protocol version
    else if (bytes[4] === 0x6d) [, offset] = readCString(bytes, offset); // GoldSrc address
    else throw new Error("Server did not return A2S_INFO");
    const [, afterName] = readCString(bytes, offset);
    const [map] = readCString(bytes, afterName);
    if (!/^[a-zA-Z0-9_-]+$/.test(map))
      throw new Error(`Unsafe map name: ${map}`);
    return map;
  } finally {
    socket.close();
  }
}

async function download(base, relative, required = false) {
  const url = new URL(relative, base);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (response.status === 404 && !required) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_FILE_BYTES) throw new Error(`${url}: file is too large`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES)
    throw new Error(`${url}: file is too large`);
  return { bytes, url: response.url };
}

function resourcePaths(text) {
  return [...text.matchAll(/^\s*"?([a-zA-Z0-9_./-]+)"?\s*(?:\/\/.*)?$/gm)]
    .map((match) => match[1])
    .filter(
      (value) =>
        !value.startsWith("/") &&
        !value.split("/").includes("..") &&
        /^(?:gfx|maps|models|sound|sprites)\/|^[^/]+\.wad$/i.test(value),
    );
}

const [addressArg, fastdlArg, fixtureArg] = process.argv.slice(2);
if (!addressArg || !fastdlArg) usage();
const address = serverAddress(addressArg);
const fastdl = new URL(fastdlArg);
if (!["http:", "https:"].includes(fastdl.protocol)) usage();
if (!fastdl.pathname.endsWith("/")) fastdl.pathname += "/";

const map = await queryMap(address);
const fixture = fixtureArg ?? address.host.replace(/[^a-zA-Z0-9_-]/g, "-");
if (!/^[a-zA-Z0-9_-]+$/.test(fixture)) throw new Error("Invalid fixture name");
const root = path.resolve(import.meta.dirname, "../local", fixture);

const bsp = await download(fastdl, `maps/${map}.bsp`, true);
if (bsp.bytes.length < 124 || bsp.bytes.readInt32LE(0) !== 30) {
  throw new Error(
    `${bsp.url} did not return a GoldSrc BSP (the FastDL host may have redirected)`,
  );
}
await mkdir(path.join(root, "maps"), { recursive: true });
await writeFile(path.join(root, "maps", `${map}.bsp`), bsp.bytes);
console.log(
  `Archived maps/${map}.bsp (${bsp.bytes.length} bytes) from ${bsp.url}`,
);

const manifest = await download(fastdl, `maps/${map}.res`);
if (manifest) {
  await writeFile(path.join(root, "maps", `${map}.res`), manifest.bytes);
  for (const relative of new Set(
    resourcePaths(manifest.bytes.toString("utf8")),
  )) {
    const resource = await download(fastdl, relative);
    if (!resource) {
      console.warn(`Missing ${relative}`);
      continue;
    }
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, resource.bytes);
    console.log(`Archived ${relative} (${resource.bytes.length} bytes)`);
  }
}
console.log(
  `Open /viewer?fixture=${encodeURIComponent(fixture)} after starting the Maps dev server.`,
);
