export interface ScanSettings {
  excludeDirs: string[];
  excludeFilenames: string[];
  excludePathPatterns: string[];
  knownGameDirs: string[];
}

/** Directories to exclude from archive scans */
export const DEFAULT_EXCLUDE_DIRS = [
  "node_modules",
  ".git",
  ".npm",
  ".cache",
  ".Trash",
  "Library/Caches",
  "Library/Logs",
  "Library/Developer",
  ".local/share/Trash",
  "__pycache__",
  ".venv",
  "venv",
  ".cargo/registry",
  ".rustup",
  "go/pkg",
  "Electron Framework.framework",
  "Chromium Embedded Framework.framework",
  "test/fixture",
  "tests/fixture",
  "Battle.net",
  "zoom.us",
  "ToDesktop Builder",
  "minecraft/launcher",
];

/** Filenames to exclude (never game assets) */
export const DEFAULT_EXCLUDE_FILENAMES = [
  "locale.pak",
  "locale.zip",
  "cached.wad",
  "resources.pak",
  "resources.zip",
  "data.zip",
];

/** Path patterns to exclude (regex strings) */
export const DEFAULT_EXCLUDE_PATH_PATTERNS = [
  "/Electron Framework\\.framework/",
  "/Chromium Embedded Framework\\.framework/",
  "/test/fixture",
  "/tests/fixture",
  "TrenchBroom.*/test/",
  "Songs of Syx",
];

/** Known game directories */
export const DEFAULT_KNOWN_GAME_DIRS = [
  "id1",
  "hipnotic",
  "rogue",
  "quoth",
  "ad",
  "alkaline",
  "baseq2",
  "ctf",
  "xatrix",
  "baseq3",
  "missionpack",
  "cpma",
  "defrag",
  "valve",
  "cstrike",
  "tfc",
  "dod",
  "gearbox",
  "bshift",
  "doom",
  "doom2",
  "plutonia",
  "tnt",
  "data",
  "pak",
  "paks",
  "base",
  "main",
];

/** Default scan settings combining all defaults */
export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  excludeDirs: DEFAULT_EXCLUDE_DIRS,
  excludeFilenames: DEFAULT_EXCLUDE_FILENAMES,
  excludePathPatterns: DEFAULT_EXCLUDE_PATH_PATTERNS,
  knownGameDirs: DEFAULT_KNOWN_GAME_DIRS,
};

/** File extensions that can be imported as game assets */
export const IMPORTABLE_EXTENSIONS = new Set([
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
  "wav",
  "mp3",
  "ogg",
  "flac",
  "m4a",
  "aiff",
  "gltf",
  "glb",
  "obj",
  "fbx",
  "md2",
  "md3",
  "mdl",
  "iqm",
  "md5mesh",
  "md5anim",
  "ase",
  "map",
  "vmf",
  "rmf",
  "cfg",
  "def",
  "mtr",
  "skin",
  "gui",
  "script",
]);
