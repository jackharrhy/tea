import { normalizeGameAssetPath } from "../core/index.js";
import type { GameAssetKind, WorldSource } from "./types.js";
import {
  abortIfNeeded,
  gameAssetUrl,
  readBinarySource,
  type LoadAssetContext,
} from "./asset-source.js";

/** Resolves case-insensitive logical game paths without coupling the BSP core to storage. */
export class GameAssetLoader {
  private readonly explicit = new Map<
    string,
    NonNullable<WorldSource["gameAssets"]>[string]
  >();

  public constructor(
    private readonly source: WorldSource,
    private readonly context: LoadAssetContext,
  ) {
    for (const [path, binary] of Object.entries(source.gameAssets ?? {})) {
      this.explicit.set(normalizeGameAssetPath(path), binary);
    }
  }

  public async read(
    path: string,
    kind: GameAssetKind,
  ): Promise<ArrayBuffer | null> {
    const normalizedPath = normalizeGameAssetPath(path);
    const explicit = this.explicit.get(normalizedPath);
    if (explicit !== undefined)
      return this.readSource(explicit, normalizedPath, kind);

    if (this.source.resolveGameAsset) {
      let resolved;
      try {
        resolved = await this.source.resolveGameAsset({
          path: normalizedPath,
          kind,
        });
      } catch (error) {
        abortIfNeeded(this.context.signal);
        throw error;
      }
      abortIfNeeded(this.context.signal);
      if (resolved !== null && resolved !== undefined) {
        return this.readSource(resolved, normalizedPath, kind);
      }
    }

    if (!this.source.gameBaseUrl) return null;
    try {
      return await this.readSource(
        gameAssetUrl(this.source.gameBaseUrl, normalizedPath),
        normalizedPath,
        kind,
      );
    } catch {
      abortIfNeeded(this.context.signal);
      return null;
    }
  }

  private readSource(
    source: NonNullable<WorldSource["gameAssets"]>[string],
    label: string,
    kind: GameAssetKind,
  ): Promise<ArrayBuffer> {
    return readBinarySource(
      source,
      kind === "palette"
        ? "palette"
        : kind === "skybox"
          ? "skybox"
          : "textures",
      label,
      this.context,
    );
  }
}
