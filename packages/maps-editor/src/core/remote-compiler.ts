import type {
  MapCompileArtifact,
  MapCompileRequest,
  MapCompileResult,
  MapCompiler,
  MapBuildCapabilities,
  MapBuildService,
  MapLaunchRequest,
  MapLaunchResult,
} from "./compiler.js";
import {
  MapBuildCapabilitiesSchema,
  MapLaunchResultSchema,
  RemoteCompileResultSchema,
  type RemoteCompileRequest,
  type RemoteLaunchRequest,
} from "./compiler-protocol.js";
import type { z } from "zod";

export type CompilerFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface RemoteMapCompilerOptions {
  readonly endpoint: string | URL;
  readonly fetch?: CompilerFetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxInputAssetBytes?: number;
  readonly maxArtifactBytes?: number;
}

function decodeBase64(value: string, limit: number): ArrayBuffer {
  const estimatedBytes = Math.floor((value.length * 3) / 4);
  if (estimatedBytes > limit)
    throw new Error(`Compiler artifact exceeds the ${limit}-byte limit`);
  const decoded = atob(value);
  if (decoded.length > limit)
    throw new Error(`Compiler artifact exceeds the ${limit}-byte limit`);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1)
    bytes[index] = decoded.charCodeAt(index);
  return bytes.buffer;
}

function encodeBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  const chunks: string[] = [];
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
    );
  }
  return btoa(chunks.join(""));
}

function parseResponse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  message: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(message);
  return result.data;
}

export class RemoteMapCompiler implements MapCompiler, MapBuildService {
  public readonly backend = "remote" as const;
  private readonly fetchImplementation: CompilerFetch;
  private readonly maxInputAssetBytes: number;
  private readonly maxArtifactBytes: number;

  public constructor(private readonly options: RemoteMapCompilerOptions) {
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxInputAssetBytes = Math.max(
      1,
      options.maxInputAssetBytes ?? 64 * 1024 * 1024,
    );
    this.maxArtifactBytes = Math.max(
      1,
      options.maxArtifactBytes ?? 128 * 1024 * 1024,
    );
  }

  public async compile(request: MapCompileRequest): Promise<MapCompileResult> {
    const inputBytes =
      request.assets?.reduce(
        (total, asset) => total + asset.data.byteLength,
        0,
      ) ?? 0;
    if (inputBytes > this.maxInputAssetBytes) {
      throw new Error(
        `Compiler inputs exceed the ${this.maxInputAssetBytes}-byte limit`,
      );
    }
    const response = await this.fetchImplementation(this.options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...this.options.headers,
      },
      body: JSON.stringify({
        mapName: request.mapName,
        mapText: request.mapText,
        quality: request.quality,
        expectedDocumentRevision: request.expectedDocumentRevision,
        profileId: request.profileId,
        assets: request.assets?.map((asset) => ({
          name: asset.name,
          mediaType: asset.mediaType,
          base64: encodeBase64(asset.data),
        })),
      } satisfies RemoteCompileRequest),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2048);
      throw new Error(
        `Compiler request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    const payload = parseResponse(
      RemoteCompileResultSchema,
      await response.json(),
      "Compiler returned an invalid result",
    );
    const artifacts: MapCompileArtifact[] = payload.artifacts.map(
      (artifact) => ({
        name: artifact.name,
        mediaType: artifact.mediaType,
        data: decodeBase64(artifact.base64, this.maxArtifactBytes),
        kind: artifact.kind,
        ...(artifact.stage ? { stage: artifact.stage } : {}),
      }),
    );
    return {
      backend: this.backend,
      status: payload.status,
      buildId: payload.buildId,
      sourceDocumentRevision: payload.sourceDocumentRevision,
      diagnostics: payload.diagnostics,
      artifacts,
      logs: payload.logs,
      elapsedMilliseconds: payload.elapsedMilliseconds,
    };
  }

  public async capabilities(
    signal?: AbortSignal,
  ): Promise<MapBuildCapabilities> {
    const endpoint = new URL("/capabilities", this.options.endpoint);
    const response = await this.fetchImplementation(endpoint, {
      headers: { accept: "application/json", ...this.options.headers },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok)
      throw new Error(
        `Build capability request failed with HTTP ${response.status}`,
      );
    return parseResponse(
      MapBuildCapabilitiesSchema,
      await response.json(),
      "Helper returned invalid capabilities",
    );
  }

  public async launch(request: MapLaunchRequest): Promise<MapLaunchResult> {
    const endpoint = new URL("/launch", this.options.endpoint);
    const response = await this.fetchImplementation(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...this.options.headers,
      },
      body: JSON.stringify({
        buildId: request.buildId,
        profileId: request.profileId,
        expectedDocumentRevision: request.expectedDocumentRevision,
      } satisfies RemoteLaunchRequest),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2048);
      throw new Error(
        `Launch request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return parseResponse(
      MapLaunchResultSchema,
      await response.json(),
      "Helper returned an invalid launch result",
    );
  }
}
