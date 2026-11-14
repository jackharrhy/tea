import fs from "node:fs";
import path from "node:path";

export const ROOT_DIR = path.resolve(import.meta.dirname, "../..");

export function loadEnv() {
  const envFile = path.join(ROOT_DIR, ".env");

  if (fs.existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

export function usage(message: string): never {
  console.log(message.trimEnd());
  process.exit(1);
}
