import { createGurgurServer } from "./server";

const port = Number(process.env.PORT ?? 3000);
const adminToken = process.env.ADMIN_TOKEN ?? "";
if (!Number.isInteger(port) || port < 1 || port > 65_535)
  throw new Error("PORT must be an integer between 1 and 65535");
if (Bun.env.NODE_ENV === "production" && adminToken.length < 16) {
  throw new Error(
    "ADMIN_TOKEN must contain at least 16 characters in production",
  );
}
if (process.env.PUBLIC_ORIGIN) {
  const origin = new URL(process.env.PUBLIC_ORIGIN);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== process.env.PUBLIC_ORIGIN.replace(/\/$/, "")
  ) {
    throw new Error("PUBLIC_ORIGIN must be an HTTP(S) origin without a path");
  }
}
const extraDynamicBodies = Number(process.env.EXTRA_DYNAMIC_BODIES ?? 0);
if (
  !Number.isInteger(extraDynamicBodies) ||
  extraDynamicBodies < 0 ||
  extraDynamicBodies > 512
) {
  throw new Error("EXTRA_DYNAMIC_BODIES must be an integer between 0 and 512");
}
const playerSpawn = process.env.PLAYER_SPAWN?.split(",").map(Number);
if (
  playerSpawn &&
  (playerSpawn.length !== 3 || !playerSpawn.every(Number.isFinite))
) {
  throw new Error(
    "PLAYER_SPAWN must contain three comma-separated finite numbers",
  );
}
const devMcpEnabled =
  Bun.env.NODE_ENV !== "production" && process.env.GURGUR_DEV_MCP !== "0";
const devMcpPort = Number(process.env.GURGUR_DEV_MCP_PORT ?? 9237);
if (
  devMcpEnabled &&
  (!Number.isInteger(devMcpPort) || devMcpPort < 1 || devMcpPort > 65_535)
) {
  throw new Error("GURGUR_DEV_MCP_PORT must be an integer between 1 and 65535");
}
const server = await createGurgurServer({
  port,
  adminToken,
  publicOrigin: process.env.PUBLIC_ORIGIN,
  extraDynamicBodies,
  playerSpawn: playerSpawn
    ? { x: playerSpawn[0]!, y: playerSpawn[1]!, z: playerSpawn[2]! }
    : undefined,
  devMcpPort: devMcpEnabled ? devMcpPort : undefined,
});
console.log(`gurgur listening on http://localhost:${server.port}`);
if (server.devMcpUrl)
  console.log(`gurgur dev MCP listening on ${server.devMcpUrl}`);

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  server.stop();
  process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
