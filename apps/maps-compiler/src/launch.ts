import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { MapLaunchResult } from "@tea/maps-editor/core";

import {
  parseCompilerGameProfile,
  safeMapName,
  type CompilerGameProfile,
} from "./compiler.js";

export interface NativeLaunchConfig {
  readonly profileId: string;
  readonly label: string;
  readonly game: CompilerGameProfile;
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
  readonly mapDirectory: string;
}

export interface LaunchableBuild {
  readonly buildId: string;
  readonly mapName: string;
  readonly sourceDocumentRevision: number;
  readonly bspBase64: string;
}

const LaunchArgumentsSchema = z.array(z.string().max(4_096)).max(256);

export function configuredLaunchProfile(
  environment: NodeJS.ProcessEnv,
): NativeLaunchConfig | null {
  const executable = environment.TEA_MAPS_LAUNCH_EXECUTABLE?.trim();
  const workingDirectory =
    environment.TEA_MAPS_LAUNCH_WORKING_DIRECTORY?.trim();
  const mapDirectory = environment.TEA_MAPS_LAUNCH_MAP_DIRECTORY?.trim();
  if (!executable || !workingDirectory || !mapDirectory) return null;
  if (![executable, workingDirectory, mapDirectory].every(isAbsolute)) {
    throw new Error(
      "Configured launch executable and directories must be absolute paths",
    );
  }
  const rawArguments = environment.TEA_MAPS_LAUNCH_ARGS_JSON ?? "[]";
  let rawArgumentsValue: unknown;
  try {
    rawArgumentsValue = JSON.parse(rawArguments);
  } catch {
    throw new Error(
      "TEA_MAPS_LAUNCH_ARGS_JSON must be a JSON array of strings",
    );
  }
  const argumentsValue = LaunchArgumentsSchema.safeParse(rawArgumentsValue);
  if (!argumentsValue.success) {
    throw new Error(
      "TEA_MAPS_LAUNCH_ARGS_JSON must be a JSON array of strings",
    );
  }
  return {
    profileId:
      environment.TEA_MAPS_LAUNCH_PROFILE_ID?.trim() || "default-launch",
    label: environment.TEA_MAPS_LAUNCH_PROFILE_LABEL?.trim() || "Local game",
    game: parseCompilerGameProfile(environment.TEA_MAPS_GAME_PROFILE),
    executable,
    arguments: argumentsValue.data,
    workingDirectory,
    mapDirectory,
  };
}

export async function launchBuild(
  build: LaunchableBuild,
  profile: NativeLaunchConfig,
): Promise<MapLaunchResult> {
  const mapName = safeMapName(build.mapName);
  await mkdir(profile.mapDirectory, { recursive: true });
  const destination = join(profile.mapDirectory, `${mapName}.bsp`);
  const temporary = join(
    profile.mapDirectory,
    `.${mapName}.${randomUUID()}.tmp`,
  );
  await writeFile(temporary, Buffer.from(build.bspBase64, "base64"), {
    flag: "wx",
  });
  await rename(temporary, destination);

  const child = spawn(
    profile.executable,
    profile.arguments.map((argument) => argument.replaceAll("%MAP%", mapName)),
    {
      cwd: profile.workingDirectory,
      detached: true,
      env: { PATH: process.env.PATH ?? "" },
      shell: false,
      stdio: "ignore",
    },
  );
  await once(child, "spawn");
  child.unref();
  return {
    buildId: build.buildId,
    profileId: profile.profileId,
    sourceDocumentRevision: build.sourceDocumentRevision,
    launchedAt: Date.now(),
  };
}
