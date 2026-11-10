import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

type SetupPlatform = "darwin" | "linux" | "win32";

export function trenchBroomUserDataPath(
  platform: SetupPlatform,
  home: string,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  if (environment.TRENCHBROOM_USER_DATA_PATH)
    return environment.TRENCHBROOM_USER_DATA_PATH;
  if (platform === "darwin")
    return posix.join(home, "Library", "Application Support", "TrenchBroom");
  if (platform === "linux") return posix.join(home, ".TrenchBroom");
  const appData = environment.APPDATA ?? win32.join(home, "AppData", "Roaming");
  return win32.join(appData, "TrenchBroom");
}

export function withGurgurGamePath(
  source: string | null,
  gamePath: string,
): string {
  const preferences = source ? (JSON.parse(source) as unknown) : {};
  if (
    !preferences ||
    typeof preferences !== "object" ||
    Array.isArray(preferences)
  ) {
    throw new Error("TrenchBroom Preferences.json must contain a JSON object");
  }
  const updated = {
    ...(preferences as Record<string, unknown>),
    "Games/Gurgur/Path": gamePath,
  };
  return `${JSON.stringify(updated, null, 4)}\n`;
}

export async function setupTrenchBroom(
  repositoryRoot = fileURLToPath(new URL("..", import.meta.url)),
): Promise<{
  configDirectory: string;
  gamePath: string;
  preferencesPath: string;
}> {
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
    throw new Error(`unsupported TrenchBroom platform: ${platform}`);
  }
  const userDataPath = trenchBroomUserDataPath(
    platform,
    homedir(),
    process.env,
  );
  const configDirectory = join(userDataPath, "games", "Gurgur");
  const generatedDirectory = join(repositoryRoot, "content", "trenchbroom");
  const gamePath = join(repositoryRoot, "content");
  const preferencesPath = join(userDataPath, "Preferences.json");

  await mkdir(configDirectory, { recursive: true });
  await copyFile(
    join(generatedDirectory, "GameConfig.cfg"),
    join(configDirectory, "GameConfig.cfg"),
  );
  await copyFile(
    join(generatedDirectory, "Gurgur.fgd"),
    join(configDirectory, "Gurgur.fgd"),
  );

  const existingPreferences = await readFile(preferencesPath, "utf8").catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    },
  );
  const temporaryPreferencesPath = join(
    dirname(preferencesPath),
    ".Preferences.gurgur.tmp.json",
  );
  await writeFile(
    temporaryPreferencesPath,
    withGurgurGamePath(existingPreferences, gamePath),
  );
  await rename(temporaryPreferencesPath, preferencesPath);

  return { configDirectory, gamePath, preferencesPath };
}

if (import.meta.main) {
  const result = await setupTrenchBroom();
  console.log(`installed Gurgur game config in ${result.configDirectory}`);
  console.log(`configured TrenchBroom game path as ${result.gamePath}`);
  console.log("restart TrenchBroom to reload the installed game configuration");
}
