import type {
  CompilerGameProfile,
  NativeCompilerRequest,
  NativeCompilerResult,
} from "./compiler.js";
import type { LaunchableBuild, NativeLaunchConfig } from "./launch.js";
import {
  RemoteCompileRequestSchema,
  MapLaunchRequestSchema,
  type MapBuildCapabilities,
  type RemoteLaunchRequest as NativeLaunchRequest,
} from "@tea/maps-editor/core";

export type { RemoteLaunchRequest as NativeLaunchRequest } from "@tea/maps-editor/core";

export function originAllowed(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  return origin === undefined || allowedOrigins.has(origin);
}

export interface CompileRequestLimits {
  readonly maxMapBytes: number;
  readonly maxAssets: number;
  readonly maxAssetBase64Bytes: number;
}

export function parseCompileRequest(
  value: unknown,
  limits: CompileRequestLimits = {
    maxMapBytes: 2 * 1024 * 1024,
    maxAssets: 16,
    maxAssetBase64Bytes: 32 * 1024 * 1024,
  },
): NativeCompilerRequest {
  const parsed = RemoteCompileRequestSchema.safeParse(value);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "profileId")) {
      throw new Error("Unknown compile profile");
    }
    throw new Error("Request contains invalid compile fields");
  }
  const request = parsed.data;
  if (request.profileId !== undefined && request.profileId !== "default") {
    throw new Error("Unknown compile profile");
  }
  if (Buffer.byteLength(request.mapText) > limits.maxMapBytes) {
    throw new Error(`Map source exceeds the ${limits.maxMapBytes} byte limit`);
  }
  if (
    request.assets !== undefined &&
    request.assets.length > limits.maxAssets
  ) {
    throw new Error("Request contains invalid compile assets");
  }
  const assetBase64Bytes =
    request.assets?.reduce((sum, asset) => sum + asset.base64.length, 0) ?? 0;
  if (assetBase64Bytes > limits.maxAssetBase64Bytes) {
    throw new Error(
      `Compile assets exceed the ${limits.maxAssetBase64Bytes} base64 byte limit`,
    );
  }
  return request;
}

export function parseLaunchRequest(value: unknown): NativeLaunchRequest {
  const request = MapLaunchRequestSchema.safeParse(value);
  if (!request.success)
    throw new Error("Request contains invalid launch fields");
  return request.data;
}

export function helperCapabilities(
  compilerConfigured: boolean,
  game: CompilerGameProfile,
  launchProfile: NativeLaunchConfig | null,
): MapBuildCapabilities {
  return {
    protocolVersion: 1,
    compileProfiles: compilerConfigured
      ? [
          {
            id: "default",
            label:
              game === "quake2" ? "Local q2tools-220" : "Local ericw-tools",
            game,
            qualities: ["preview", "final"],
          },
        ]
      : [],
    launchProfiles: launchProfile
      ? [
          {
            id: launchProfile.profileId,
            label: launchProfile.label,
            game: launchProfile.game,
          },
        ]
      : [],
  };
}

export class BoundedBuildHistory {
  private readonly builds = new Map<string, LaunchableBuild>();

  public constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Build history limit must be a positive integer");
    }
  }

  public remember(
    request: NativeCompilerRequest,
    result: NativeCompilerResult,
  ): void {
    if (result.status !== "succeeded") return;
    const bsp = result.artifacts.find((artifact) => artifact.kind === "bsp");
    if (!bsp) return;
    this.builds.set(result.buildId, {
      buildId: result.buildId,
      mapName: request.mapName,
      sourceDocumentRevision: result.sourceDocumentRevision,
      bspBase64: bsp.base64,
    });
    while (this.builds.size > this.limit) {
      const oldest = this.builds.keys().next().value;
      if (!oldest) break;
      this.builds.delete(oldest);
    }
  }

  public get(buildId: string): LaunchableBuild | undefined {
    return this.builds.get(buildId);
  }
}
