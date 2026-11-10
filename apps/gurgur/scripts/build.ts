import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { loadAssetManifest } from "../server/src/material-textures";

const materialTextureRoot = new URL("../content/textures/", import.meta.url);
const spriteRoot = new URL("../content/sprites/", import.meta.url);
const audioRoot = new URL("../content/audio/", import.meta.url);
const compiledMap = new Uint8Array(
  await Bun.file("content/generated/systems-garden.bin").arrayBuffer(),
);
const compiledMapHash = new Bun.CryptoHasher("sha256")
  .update(compiledMap)
  .digest("hex");
if (
  compiledMapHash !==
  "4006aa669800b3185481ac1be74baf283afc522b0c16834bdc9882e958840904"
)
  throw new Error(
    "compiled map changed; saved Gurgur worlds require the committed map revision",
  );
const lintalkerArtifacts = [
  {
    path: "third_party/lintalker/wintalker.js",
    sha256: "6e25db22cdf4093cf281affbe5f140c7feec6b391663565ba9a00d86aee4264c",
  },
  {
    path: "third_party/lintalker/wintalker.wasm",
    sha256: "7f9c4522da11019ed54e81d634bd21edfded63ecebf1c509da5f5db11cc2925b",
  },
] as const;
for (const artifact of lintalkerArtifacts) {
  const hash = new Bun.CryptoHasher("sha256")
    .update(new Uint8Array(await Bun.file(artifact.path).arrayBuffer()))
    .digest("hex");
  if (hash !== artifact.sha256)
    throw new Error(
      `pinned LinTalker artifact hash mismatch: ${artifact.path}`,
    );
}
const assetManifest = await loadAssetManifest(
  materialTextureRoot,
  spriteRoot,
  audioRoot,
);
const compiledWorld = (await Bun.file(
  "content/generated/systems-garden.json",
).json()) as {
  brushes: Array<{ triangleMaterials: string[] }>;
  entities: Array<{
    kind: string;
    asset?: string;
    presentation: { kind: string; asset?: string };
  }>;
};
const requiredMaterials = new Set(
  compiledWorld.brushes.flatMap((brush) => brush.triangleMaterials),
);
for (const material of requiredMaterials) {
  if (!assetManifest.materials[material]) {
    throw new Error(
      `missing authored material texture: content/textures/${material}.png`,
    );
  }
}
for (const entity of compiledWorld.entities) {
  if (
    entity.presentation.kind === "sprite" &&
    !assetManifest.sprites[entity.presentation.asset!]
  )
    throw new Error(
      `missing authored sprite: content/sprites/${entity.presentation.asset}.png`,
    );
  if (entity.kind === "ambient-audio" && !assetManifest.audio[entity.asset!])
    throw new Error(
      `missing authored audio: content/audio/${entity.asset}.mp3`,
    );
}

await rm("dist", { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: ["server/src/index.ts"],
  outdir: "dist",
  root: ".",
  target: "bun",
  minify: true,
  sourcemap: "linked",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const speechWorkerResult = await Bun.build({
  entrypoints: ["web/src/speech-worker.ts"],
  outdir: "dist",
  root: ".",
  target: "browser",
  format: "iife",
  minify: true,
  sourcemap: "linked",
});
if (!speechWorkerResult.success) {
  for (const log of speechWorkerResult.logs) console.error(log);
  process.exit(1);
}

const physicsWorkerResult = await Bun.build({
  entrypoints: ["web/src/physics-worker.ts"],
  outdir: "dist",
  root: ".",
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "linked",
});
if (!physicsWorkerResult.success) {
  for (const log of physicsWorkerResult.logs) console.error(log);
  process.exit(1);
}

const debugCaptureWorkerResult = await Bun.build({
  entrypoints: ["web/src/debug-capture-worker.ts"],
  outdir: "dist",
  root: ".",
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "linked",
});
if (!debugCaptureWorkerResult.success) {
  for (const log of debugCaptureWorkerResult.logs) console.error(log);
  process.exit(1);
}

await mkdir("dist/server/src", { recursive: true });
await mkdir("dist/content/generated", { recursive: true });
await mkdir("dist/content/generated/player-billboard", { recursive: true });
await mkdir("dist/third_party/lintalker", { recursive: true });
let materialTextureCount = 0;
for await (const path of new Bun.Glob("**/*.png").scan({
  cwd: "content/textures",
  dot: false,
})) {
  const destination = `dist/content/textures/${path}`;
  await mkdir(dirname(destination), { recursive: true });
  await Bun.write(destination, Bun.file(`content/textures/${path}`));
  materialTextureCount += 1;
}
let spriteCount = 0;
for await (const path of new Bun.Glob("**/*.png").scan({
  cwd: "content/sprites",
  dot: false,
})) {
  const destination = `dist/content/sprites/${path}`;
  await mkdir(dirname(destination), { recursive: true });
  await Bun.write(destination, Bun.file(`content/sprites/${path}`));
  spriteCount += 1;
}
let audioCount = 0;
for await (const path of new Bun.Glob("**/*.mp3").scan({
  cwd: "content/audio",
  dot: false,
})) {
  const destination = `dist/content/audio/${path}`;
  await mkdir(dirname(destination), { recursive: true });
  await Bun.write(destination, Bun.file(`content/audio/${path}`));
  audioCount += 1;
}
await Bun.write(
  "dist/server/src/box3d.wasm",
  Bun.file(
    new URL("../../../node_modules/box3d.js/dist/box3d.wasm", import.meta.url),
  ),
);
await Bun.write(
  "dist/content/generated/systems-garden.bin",
  Bun.file("content/generated/systems-garden.bin"),
);
await Bun.write(
  "dist/content/generated/player-billboard/player-billboard.png",
  Bun.file("content/generated/player-billboard/player-billboard.png"),
);
await Bun.write(
  "dist/third_party/lintalker/wintalker.js",
  Bun.file("third_party/lintalker/wintalker.js"),
);
await Bun.write(
  "dist/third_party/lintalker/wintalker.wasm",
  Bun.file("third_party/lintalker/wintalker.wasm"),
);
console.log(
  `built ${result.outputs.length + speechWorkerResult.outputs.length + physicsWorkerResult.outputs.length + debugCaptureWorkerResult.outputs.length} files, box3d.wasm, LinTalker, ${materialTextureCount} authored textures, ${spriteCount} sprites, and ${audioCount} audio assets`,
);
