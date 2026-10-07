import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const source = createRequire(import.meta.url).resolve(
  "@material-symbols/font-400/material-symbols-rounded.woff2",
);
const destination = resolve(
  rootDir,
  "public/fonts/material-symbols-rounded.woff2",
);

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
