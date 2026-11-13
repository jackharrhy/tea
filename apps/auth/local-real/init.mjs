import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  openSync,
  writeFileSync,
  existsSync,
  closeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.umask(0o077);
const state = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.local-real",
);
if (existsSync(resolve(state, "compose.env"))) {
  console.log(
    "Local identity state already exists; keeping its credentials and database.",
  );
  process.exit(0);
}
mkdirSync(resolve(state, "bootstrap"), { recursive: true, mode: 0o700 });
const values = {
  AUTH_REAL_STATE: state,
  AUTH_REAL_PROJECT: `harrhy-auth-real-${createHash("sha256").update(state).digest("hex").slice(0, 8)}`,
  AUTH_REAL_POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
  AUTH_REAL_MASTERKEY: randomBytes(16).toString("hex"),
  AUTH_REAL_PAT_EXPIRY: new Date(Date.now() + 30 * 86400_000).toISOString(),
};
const file = resolve(state, "compose.env");
const fd = openSync(file, "wx", 0o600);
try {
  writeFileSync(
    fd,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
} finally {
  closeSync(fd);
}
console.log(
  "Created ignored local identity settings. Run npm run auth:real:up, then npm run auth:real:seed.",
);
