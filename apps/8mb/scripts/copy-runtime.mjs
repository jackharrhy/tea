import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
for (const [specifier, path] of [
  ["@ffmpeg/core", "ffmpeg/ffmpeg-core.js"],
  ["@ffmpeg/core/wasm", "ffmpeg/ffmpeg-core.wasm"],
  ["@ffmpeg/core-mt", "ffmpeg-mt/ffmpeg-core.js"],
  ["@ffmpeg/core-mt/wasm", "ffmpeg-mt/ffmpeg-core.wasm"],
  ["@ffmpeg/core-mt/worker", "ffmpeg-mt/ffmpeg-core.worker.js"],
]) {
  const destination = `public/${path}`;
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(fileURLToPath(import.meta.resolve(specifier)), destination);
}
