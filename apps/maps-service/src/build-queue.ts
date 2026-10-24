import type { BlobStore } from "./blob-store.js";
import type { MapsDatabase } from "./database.js";
import { hostedBuildProfile } from "./hosted-game-profiles.js";
import { createWorldPackage } from "./world-package.js";
import {
  RemoteCompileResultSchema,
  compiledBspVersion,
  type RemoteCompileRequest,
} from "@tea/maps-editor/core";
import { HostedErrorResponseSchema, type HostedGame } from "@tea/maps-protocol";
import { Agent } from "undici";

const compileDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

interface QueuedBuild {
  readonly id: string;
  readonly game: HostedGame;
  readonly mapName: string;
  readonly source: string;
  readonly mapVersion: number;
  readonly sourceSha256: string;
  readonly profileId: string;
  readonly quality: "preview" | "final";
  readonly assets: readonly {
    name: string;
    mediaType: string;
    bytes: Uint8Array;
  }[];
}

export class RemoteBuildQueue {
  private readonly pending: QueuedBuild[] = [];
  private active = 0;
  public constructor(
    private readonly database: MapsDatabase,
    private readonly blobs: BlobStore,
    private readonly endpoints: Partial<Record<HostedGame, string>>,
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
    private readonly concurrency = 1,
    private readonly maxPending = 3,
  ) {}

  public supports(game: HostedGame): boolean {
    return Boolean(this.endpoints[game]);
  }

  public enqueue(input: QueuedBuild): boolean {
    if (this.pending.length >= this.maxPending) return false;
    this.pending.push(input);
    this.drain();
    return true;
  }

  private async run(input: QueuedBuild): Promise<void> {
    this.database.updateBuild(input.id, "running");
    try {
      const endpoint = this.endpoints[input.game];
      if (!endpoint)
        throw new Error(`No ${input.game} build worker is configured`);
      const profile = hostedBuildProfile(input.game);
      const requestOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapName: input.mapName.replace(/\.map$/i, ""),
          mapText: input.source,
          quality: input.quality,
          profileId: input.profileId,
          expectedDocumentRevision: input.mapVersion,
          assets: input.assets.map((asset) => ({
            name: asset.name,
            mediaType: asset.mediaType,
            base64: Buffer.from(asset.bytes).toString("base64"),
          })),
        } satisfies RemoteCompileRequest),
        signal: AbortSignal.timeout(profile.buildTimeoutMilliseconds),
        dispatcher: compileDispatcher,
      };
      const response = await this.fetch(
        new URL("/compile", endpoint),
        requestOptions,
      );
      const payload: unknown = await response.json().catch(() => null);
      const result = RemoteCompileResultSchema.safeParse(payload);
      if (!response.ok || !result.success) {
        const error = HostedErrorResponseSchema.safeParse(payload);
        const detail = error.success ? error.data.error : null;
        throw new Error(
          typeof detail === "string"
            ? detail
            : `Build worker failed (${response.status})`,
        );
      }
      if (result.data.sourceDocumentRevision !== input.mapVersion) {
        throw new Error("Build worker returned a different map revision");
      }
      if (result.data.status === "succeeded") {
        const bsp = result.data.artifacts.find(
          (artifact) => artifact.kind === "bsp",
        );
        const version = bsp
          ? compiledBspVersion(
              Uint8Array.from(Buffer.from(bsp.base64, "base64")).buffer,
            )
          : null;
        if (version === null || !profile.bspVersions.includes(version))
          throw new Error(
            `Build worker returned the wrong BSP format for ${input.game}. Check its game profile configuration.`,
          );
      }
      const artifacts = [];
      for (const artifact of result.data.artifacts) {
        const blob = await this.blobs.put(
          Buffer.from(artifact.base64, "base64"),
        );
        artifacts.push({
          name: artifact.name,
          kind: artifact.kind,
          mediaType: artifact.mediaType,
          sha256: blob.sha256,
          size: blob.size,
        });
      }
      const packageExtension =
        profile.resourceLayout === "game-tree"
          ? profile.packageExtension
          : undefined;
      if (packageExtension && result.data.status === "succeeded") {
        const bsp = result.data.artifacts.find(
          (artifact) => artifact.kind === "bsp",
        );
        if (!bsp) throw new Error("Compiler returned no BSP");
        const packageBytes = createWorldPackage(
          bsp.name,
          Buffer.from(bsp.base64, "base64"),
          input.assets,
        );
        const stored = await this.blobs.put(packageBytes);
        artifacts.push({
          name: bsp.name.replace(/\.bsp$/i, `.${packageExtension}`),
          kind: "package" as const,
          mediaType: "application/zip",
          sha256: stored.sha256,
          size: stored.size,
        });
      }
      this.database.updateBuild(
        input.id,
        result.data.status,
        {
          diagnostics: result.data.diagnostics,
          logs: result.data.logs,
          elapsedMilliseconds: result.data.elapsedMilliseconds,
          artifacts,
        },
        input.sourceSha256,
      );
    } catch (error) {
      this.database.updateBuild(
        input.id,
        "failed",
        { error: error instanceof Error ? error.message : String(error) },
        input.sourceSha256,
      );
    }
  }

  private drain(): void {
    while (this.active < this.concurrency && this.pending.length) {
      const input = this.pending.shift()!;
      this.active += 1;
      void this.run(input).finally(() => {
        this.active -= 1;
        this.drain();
      });
    }
  }
}
