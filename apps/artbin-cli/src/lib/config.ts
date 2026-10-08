import envPaths from "env-paths";
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { join, dirname } from "path";

const paths = envPaths("artbin", { suffix: "" });
const CONFIG_FILE = join(paths.config, "config.json");
const DEFAULT_SERVER_URL = "https://artbin.jackharrhy.dev";

export interface Config {
  serverUrl: string;
  sessionId: string;
}

export async function loadConfig(): Promise<Config | null> {
  const environmentServerUrl = process.env.ARTBIN_SERVER_URL;
  const environmentSessionId = process.env.ARTBIN_SESSION_ID;
  if (environmentServerUrl && environmentSessionId) {
    return { serverUrl: environmentServerUrl, sessionId: environmentSessionId };
  }

  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (data.serverUrl && data.sessionId) {
      return data as Config;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export async function deleteConfig(): Promise<void> {
  try {
    await unlink(CONFIG_FILE);
  } catch {
    // File may not exist
  }
}

export function getDefaultServerUrl(): string {
  return DEFAULT_SERVER_URL;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
