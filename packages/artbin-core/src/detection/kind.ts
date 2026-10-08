import { extname } from "path";

export const fileKinds = [
  "texture",
  "model",
  "audio",
  "map",
  "archive",
  "config",
  "other",
] as const;
export type FileKind = (typeof fileKinds)[number];

const KIND_EXTENSIONS: Record<FileKind, string[]> = {
  texture: [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "tga",
    "bmp",
    "pcx",
    "wal",
    "vtf",
    "dds",
  ],
  model: [
    "gltf",
    "glb",
    "obj",
    "fbx",
    "md2",
    "md3",
    "mdl",
    "md5mesh",
    "md5anim",
    "ase",
    "lwo",
    "iqm",
    "blend",
  ],
  audio: ["wav", "mp3", "ogg", "flac", "m4a", "aiff"],
  map: ["bsp", "map", "vmf", "rmf"],
  archive: ["pk3", "pk4", "pak", "wad", "zip", "7z", "rar", "tar", "gz"],
  config: [
    "cfg",
    "txt",
    "json",
    "xml",
    "ini",
    "yaml",
    "yml",
    "toml",
    "rc",
    "conf",
  ],
  other: [],
};

export function detectKind(filename: string): FileKind {
  const ext = extname(filename).toLowerCase().slice(1);

  for (const [kind, extensions] of Object.entries(KIND_EXTENSIONS)) {
    if (extensions.includes(ext)) {
      return kind as FileKind;
    }
  }

  return "other";
}

export function isImageKind(kind: FileKind): boolean {
  return kind === "texture";
}

export function needsPreview(filename: string): boolean {
  const ext = extname(filename).toLowerCase().slice(1);
  return ["tga", "bmp", "pcx", "wal", "vtf", "dds"].includes(ext);
}

export function isWebImage(filename: string): boolean {
  const ext = extname(filename).toLowerCase().slice(1);
  return ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
}
