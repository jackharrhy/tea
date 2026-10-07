import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { gameTreeAssetPath } from "@tea/maps-protocol";

import type {
  MapCompileDiagnostic as NativeCompileDiagnostic,
  MapCompileQuality as CompileQuality,
  RemoteCompileRequest as NativeCompilerRequest,
  RemoteCompileResult as NativeCompilerResult,
  WorldviewGameProfile as CompilerGameProfile,
} from "@tea/maps-editor/core";
import { WorldviewGameProfileSchema } from "@tea/maps-editor/core";

export type {
  MapCompileQuality as CompileQuality,
  RemoteCompileRequest as NativeCompilerRequest,
  RemoteCompileResult as NativeCompilerResult,
  WorldviewGameProfile as CompilerGameProfile,
} from "@tea/maps-editor/core";

export function parseCompilerGameProfile(
  value: string | undefined,
): CompilerGameProfile {
  if (value === undefined || value.trim() === "") return "quake";
  const parsed = WorldviewGameProfileSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error("TEA_MAPS_GAME_PROFILE is not a supported game");
}

export type NativeCompilerToolchain =
  | {
      readonly kind: "ericw";
      readonly target: "quake" | "goldsrc" | "quake2";
      readonly qbsp: string;
      readonly vis: string;
      readonly light: string;
    }
  | { readonly kind: "q2tool"; readonly executable: string };

export interface NativeCompilerConfig {
  readonly toolchain: NativeCompilerToolchain;
  readonly gameDirectory?: string;
  readonly maxThreads: number;
  readonly timeoutMilliseconds: number;
  readonly maxLogBytes: number;
  readonly maxArtifactBytes: number;
}

interface StageResult {
  readonly stage: string;
  readonly output: string;
  readonly truncated: boolean;
}

export interface NativeCompilerStage {
  readonly stage: "qbsp" | "vis" | "light" | "q2tool";
  readonly executable: string;
  readonly args: readonly string[];
}

export class NativeCompileError extends Error {
  public constructor(
    public readonly stage: string,
    message: string,
    public readonly output: string,
    public readonly truncated = false,
  ) {
    super(message);
    this.name = "NativeCompileError";
  }
}

export function safeMapName(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
    throw new Error(
      "mapName must contain 1-64 ASCII letters, digits, underscores, or hyphens",
    );
  }
  return value;
}

export function safeAssetName(value: string): string {
  if (
    !/^[a-zA-Z0-9_.-]{1,128}$/.test(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(
      "Asset names must be safe basenames containing 1-128 ASCII token characters",
    );
  }
  const extension = value.toLowerCase().split(".").at(-1);
  if (
    !extension ||
    !["wad", "lmp", "pal", "rad", "png", "tga"].includes(extension)
  ) {
    throw new Error(`Asset ${value} has an unsupported extension`);
  }
  return value;
}

export function compilerStages(
  quality: CompileQuality,
  mapPath: string,
  bspPath: string,
  config: Pick<
    NativeCompilerConfig,
    "gameDirectory" | "maxThreads" | "toolchain"
  >,
  assetDirectory?: string,
): readonly NativeCompilerStage[] {
  if (
    config.toolchain.kind === "ericw" &&
    config.toolchain.target === "quake2"
  ) {
    if (!assetDirectory)
      throw new Error("Quake II builds require a game asset root");
    const common = ["-gamedir", assetDirectory];
    const threads = ["-threads", String(config.maxThreads)];
    return [
      {
        stage: "qbsp",
        executable: config.toolchain.qbsp,
        args: [
          ...common,
          ...threads,
          "-q2bsp",
          "-noallowupgrade",
          "-leaktest",
          mapPath,
        ],
      },
      {
        stage: "vis",
        executable: config.toolchain.vis,
        args: [...threads, bspPath],
      },
      {
        stage: "light",
        executable: config.toolchain.light,
        args: [
          ...common,
          ...threads,
          "-extra4",
          "-emissivequality",
          "low",
          "-visapprox",
          "vis",
          bspPath,
        ],
      },
    ];
  }
  if (config.toolchain.kind === "q2tool") {
    return [
      {
        stage: "q2tool",
        executable: config.toolchain.executable,
        args: [
          "-bsp",
          "-vis",
          ...(quality === "final" ? ["-rad"] : []),
          "-threads",
          String(config.maxThreads),
          ...(config.gameDirectory || assetDirectory
            ? ["-gamedir", config.gameDirectory ?? assetDirectory!]
            : []),
          ...(quality === "preview" ? ["-fast"] : ["-extra"]),
          mapPath,
        ],
      },
    ];
  }
  const paths = [
    "-nodefaultpaths",
    ...(config.gameDirectory ? ["-gamedir", config.gameDirectory] : []),
    ...(assetDirectory ? ["-path", assetDirectory] : []),
  ];
  const common = [
    "-nolog",
    "-nocolor",
    "-threads",
    String(config.maxThreads),
    ...paths,
  ];
  return [
    {
      stage: "qbsp",
      executable: config.toolchain.qbsp,
      args: [
        ...common,
        ...(config.toolchain.target === "goldsrc" ? ["-hlbsp"] : []),
        ...(assetDirectory ? ["-wadpath", assetDirectory] : []),
        ...(quality === "preview" ? ["-nofill"] : []),
        mapPath,
        bspPath,
      ],
    },
    {
      stage: "vis",
      executable: config.toolchain.vis,
      args: [...common, ...(quality === "preview" ? ["-fast"] : []), bspPath],
    },
    {
      stage: "light",
      executable: config.toolchain.light,
      args: [
        ...common,
        ...(quality === "preview" ? ["-gate", "1"] : ["-extra"]),
        bspPath,
      ],
    },
  ];
}

function abortError(): Error {
  return Object.assign(new Error("Compilation cancelled"), {
    name: "AbortError",
  });
}

async function runStage(
  stage: string,
  executable: string,
  args: readonly string[],
  workingDirectory: string,
  config: Pick<NativeCompilerConfig, "maxLogBytes" | "timeoutMilliseconds">,
  signal?: AbortSignal,
): Promise<StageResult> {
  if (signal?.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: workingDirectory,
      env: { PATH: process.env.PATH ?? "" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const append = (chunk: Buffer) => {
      if (output.length >= config.maxLogBytes) {
        truncated = true;
        return;
      }
      const text = chunk.toString("utf8");
      const remaining = config.maxLogBytes - output.length;
      output += text.slice(0, remaining);
      truncated ||= text.length > remaining;
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, config.timeoutMilliseconds);
    const cancel = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", cancel, { once: true });
    const finish = (error?: Error, result?: StageResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve(result!);
    };
    child.once("error", (error) =>
      finish(new NativeCompileError(stage, error.message, output, truncated)),
    );
    child.once("close", (code, closeSignal) => {
      if (signal?.aborted) finish(abortError());
      else if (timedOut) {
        finish(
          new NativeCompileError(
            stage,
            `${stage} exceeded the ${config.timeoutMilliseconds}ms timeout`,
            output,
            truncated,
          ),
        );
      } else if (code !== 0) {
        finish(
          new NativeCompileError(
            stage,
            `${stage} exited with ${code ?? closeSignal ?? "an unknown status"}`,
            output,
            truncated,
          ),
        );
      } else finish(undefined, { stage, output, truncated });
    });
  });
}

function diagnosticSeverity(line: string): NativeCompileDiagnostic["severity"] {
  if (/\b(?:error|fatal|leak(?:ed|ing)?)\b/i.test(line)) return "error";
  if (/\bwarn(?:ing)?\b/i.test(line)) return "warning";
  return "info";
}

function stageDiagnostics(
  stage: string,
  output: string,
): readonly NativeCompileDiagnostic[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.length > 0 ? lines : [`${stage} completed`]).map((message) => ({
    severity: diagnosticSeverity(message),
    stage,
    message,
  }));
}

function artifactMetadata(name: string): {
  readonly kind: "bsp" | "portal" | "leak-path" | "log" | "other";
  readonly mediaType: string;
  readonly stage?: string;
} {
  const extension = name.toLowerCase().split(".").at(-1);
  if (extension === "bsp")
    return { kind: "bsp", mediaType: "application/x-quake-bsp" };
  if (extension === "prt")
    return {
      kind: "portal",
      mediaType: "application/x-quake-portal",
      stage: "qbsp",
    };
  if (extension === "pts" || extension === "lin") {
    return { kind: "leak-path", mediaType: "text/plain", stage: "qbsp" };
  }
  if (extension === "log") return { kind: "log", mediaType: "text/plain" };
  return { kind: "other", mediaType: "application/octet-stream" };
}

async function collectArtifacts(
  workingDirectory: string,
  maxArtifactBytes: number,
): Promise<NativeCompilerResult["artifacts"]> {
  const names = await readdir(workingDirectory);
  const allowed = names
    .filter((name) => /\.(?:bsp|prt|pts|lin|log)$/i.test(name))
    .toSorted();
  let totalBytes = 0;
  for (const name of allowed) {
    totalBytes += (await stat(join(workingDirectory, name))).size;
    if (totalBytes > maxArtifactBytes) {
      throw new Error(
        `Compiler artifacts exceed the ${maxArtifactBytes} byte limit`,
      );
    }
  }
  return Promise.all(
    allowed.map(async (name) => {
      const metadata = artifactMetadata(name);
      const base64 = (await readFile(join(workingDirectory, name))).toString(
        "base64",
      );
      return Object.assign({ name, base64 }, metadata);
    }),
  );
}

export async function compileNativeMap(
  request: NativeCompilerRequest,
  config: NativeCompilerConfig,
  signal?: AbortSignal,
): Promise<NativeCompilerResult> {
  const started = performance.now();
  const buildId = randomUUID();
  const mapName = safeMapName(request.mapName);
  if (
    config.toolchain.kind === "q2tool" &&
    config.gameDirectory &&
    request.assets?.length
  ) {
    throw new Error(
      "Quake II project assets cannot be combined with TEA_MAPS_GAME_DIR; use one game tree for this build",
    );
  }
  const workingDirectory = await mkdtemp(join(tmpdir(), "tea-maps-compile-"));
  const expectedPrefix = join(tmpdir(), "tea-maps-compile-");
  if (!workingDirectory.startsWith(expectedPrefix)) {
    throw new Error("Refusing to use an unexpected compiler working directory");
  }
  const gameTree =
    (config.toolchain.kind === "q2tool" && Boolean(request.assets?.length)) ||
    (config.toolchain.kind === "ericw" && config.toolchain.target === "quake2");
  const assetDirectory =
    request.assets?.length || gameTree
      ? join(workingDirectory, "assets")
      : undefined;
  const outputDirectory = gameTree
    ? join(workingDirectory, "assets", "maps")
    : workingDirectory;
  const mapPath = join(outputDirectory, `${mapName}.map`);
  const bspPath = join(outputDirectory, `${mapName}.bsp`);
  try {
    if (gameTree) await mkdir(outputDirectory, { recursive: true });
    await writeFile(mapPath, request.mapText, { encoding: "utf8", flag: "wx" });
    if (assetDirectory && request.assets) {
      await mkdir(assetDirectory, { recursive: true });
      for (const asset of request.assets) {
        if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(asset.base64)) {
          throw new Error(`Asset ${asset.name} is not valid base64`);
        }
        const path = gameTree
          ? gameTreeAssetPath(asset.name)
          : safeAssetName(asset.name);
        const destination = join(assetDirectory, path);
        if (gameTree) await mkdir(join(destination, ".."), { recursive: true });
        await writeFile(destination, Buffer.from(asset.base64, "base64"), {
          flag: "wx",
        });
      }
    }
    const stages: StageResult[] = [];
    let failure: NativeCompileError | null = null;
    for (const stage of compilerStages(
      request.quality,
      mapPath,
      bspPath,
      config,
      assetDirectory,
    )) {
      try {
        stages.push(
          await runStage(
            stage.stage,
            stage.executable,
            stage.args,
            outputDirectory,
            config,
            signal,
          ),
        );
      } catch (error) {
        if (error instanceof NativeCompileError) {
          failure = error;
          stages.push({
            stage: error.stage,
            output: error.output,
            truncated: error.truncated,
          });
          break;
        }
        throw error;
      }
    }
    const artifacts = await collectArtifacts(
      outputDirectory,
      config.maxArtifactBytes,
    );
    const diagnostics = stages.flatMap(({ stage, output }) =>
      stageDiagnostics(stage, output),
    );
    if (
      !failure &&
      config.toolchain.kind === "ericw" &&
      config.toolchain.target === "goldsrc"
    ) {
      const bsp = artifacts.find((artifact) => artifact.kind === "bsp");
      const bytes = bsp ? Buffer.from(bsp.base64, "base64") : null;
      if (bytes && (bytes.length < 124 || bytes.readUInt32LE(0) !== 30)) {
        failure = new NativeCompileError(
          "qbsp",
          "GoldSrc build did not produce BSP30. Use an ericw-tools version with -hlbsp support.",
          "",
        );
      }
    }
    if (failure) {
      diagnostics.push({
        severity: "error",
        stage: failure.stage,
        message: failure.message,
      });
    } else if (!artifacts.some(({ kind }) => kind === "bsp")) {
      diagnostics.push({
        severity: "error",
        stage: "compiler",
        message: "Compiler produced no BSP artifact",
      });
    }
    const status =
      failure || !artifacts.some(({ kind }) => kind === "bsp")
        ? "failed"
        : "succeeded";
    return {
      status,
      buildId,
      sourceDocumentRevision: request.expectedDocumentRevision,
      diagnostics,
      artifacts,
      logs: stages.map(({ stage, output, truncated }) => ({
        stage,
        text: output,
        truncated,
      })),
      elapsedMilliseconds: performance.now() - started,
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}
