import { copyFile } from "node:fs/promises";

// Retire the root-scoped service worker installed by older previews.
await copyFile("public/sw.js", "dist/sw.js");
