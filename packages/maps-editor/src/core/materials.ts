import {
  createQuakePalette,
  decodeMipTexture,
  decodeWalTexture,
  parseWad,
  readMipTextureHeader,
  WAD2_MIPTEX,
  WAD3_MIPTEX,
} from "@jackharrhy/tea-maps-renderer/core";

export interface EditorMaterial {
  readonly name: string;
  readonly sourceName: string;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly alphaTest: boolean;
  /** Texture-coordinate dimensions when a replacement image has different pixel dimensions. */
  readonly logicalWidth?: number;
  readonly logicalHeight?: number;
}

export interface MaterialImportDiagnostic {
  readonly severity: "warning" | "error";
  readonly sourceName: string;
  readonly materialName?: string;
  readonly message: string;
}

export interface MaterialImportResult {
  readonly sourceName: string;
  readonly wadVersion: 2 | 3;
  readonly added: number;
  readonly replaced: number;
  readonly skipped: number;
  readonly diagnostics: readonly MaterialImportDiagnostic[];
}

export interface WalMaterialImportResult {
  readonly sourceName: string;
  readonly materialName?: string;
  readonly animationName?: string;
  readonly surface?: {
    readonly contents: number;
    readonly flags: number;
    readonly value: number;
  };
  readonly added: number;
  readonly replaced: number;
  readonly skipped: number;
  readonly diagnostics: readonly MaterialImportDiagnostic[];
}

const MAX_EDITOR_TEXTURE_DIMENSION = 4096;
const MAX_EDITOR_TEXTURE_PIXELS = 16_777_216;

function materialKey(name: string): string {
  return name.trim().toLowerCase();
}

export class EditorMaterialCatalog {
  private readonly entries = new Map<string, EditorMaterial>();

  public get size(): number {
    return this.entries.size;
  }

  public materials(): readonly EditorMaterial[] {
    return [...this.entries.values()].toSorted((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
  }

  public find(name: string): EditorMaterial | null {
    return this.entries.get(materialKey(name)) ?? null;
  }

  public clear(): void {
    this.entries.clear();
  }

  /** Registers a generated or otherwise pre-decoded runtime material. Returns true when replaced. */
  public set(material: EditorMaterial): boolean {
    const key = materialKey(material.name);
    if (!key) throw new Error("Material names cannot be empty");
    if (
      material.width <= 0 ||
      material.height <= 0 ||
      material.width > MAX_EDITOR_TEXTURE_DIMENSION ||
      material.height > MAX_EDITOR_TEXTURE_DIMENSION ||
      material.width * material.height > MAX_EDITOR_TEXTURE_PIXELS
    ) {
      throw new Error(`Material ${material.name} has unsupported dimensions`);
    }
    if (material.rgba.byteLength !== material.width * material.height * 4) {
      throw new Error(
        `Material ${material.name} has inconsistent RGBA dimensions`,
      );
    }
    const logicalWidth = material.logicalWidth ?? material.width;
    const logicalHeight = material.logicalHeight ?? material.height;
    if (
      logicalWidth <= 0 ||
      logicalHeight <= 0 ||
      !Number.isFinite(logicalWidth) ||
      !Number.isFinite(logicalHeight)
    ) {
      throw new Error(
        `Material ${material.name} has invalid logical dimensions`,
      );
    }
    const replaced = this.entries.has(key);
    this.entries.set(key, material);
    return replaced;
  }

  public importWad(
    sourceName: string,
    input: ArrayBuffer | ArrayBufferView,
    externalPalette?: Uint8Array,
  ): MaterialImportResult {
    const wad = parseWad(input);
    const expectedType = wad.version === 2 ? WAD2_MIPTEX : WAD3_MIPTEX;
    const candidates = wad.lumps.filter((lump) => lump.type === expectedType);
    const diagnostics: MaterialImportDiagnostic[] = [];
    let added = 0;
    let replaced = 0;
    let skipped = 0;

    const palette =
      wad.version === 2 ? (externalPalette ?? createQuakePalette()) : undefined;

    for (const lump of candidates) {
      try {
        const header = readMipTextureHeader(lump.data);
        if (
          header.width > MAX_EDITOR_TEXTURE_DIMENSION ||
          header.height > MAX_EDITOR_TEXTURE_DIMENSION ||
          header.width * header.height > MAX_EDITOR_TEXTURE_PIXELS
        ) {
          throw new Error(
            `texture dimensions ${header.width}x${header.height} exceed the editor preview limit`,
          );
        }
        const decoded = decodeMipTexture(lump.data, palette);
        const material: EditorMaterial = {
          name: decoded.name || lump.name,
          sourceName,
          width: decoded.width,
          height: decoded.height,
          rgba: decoded.levels[0]!.rgba,
          alphaTest: decoded.alphaTest,
        };
        if (this.set(material)) replaced += 1;
        else added += 1;
      } catch (error) {
        skipped += 1;
        diagnostics.push({
          severity: "warning",
          sourceName,
          materialName: lump.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      sourceName,
      wadVersion: wad.version,
      added,
      replaced,
      skipped,
      diagnostics,
    };
  }

  public importWal(
    sourceName: string,
    input: ArrayBuffer | ArrayBufferView,
    palette: Uint8Array,
  ): WalMaterialImportResult {
    try {
      const decoded = decodeWalTexture(input, palette);
      if (
        decoded.width > MAX_EDITOR_TEXTURE_DIMENSION ||
        decoded.height > MAX_EDITOR_TEXTURE_DIMENSION ||
        decoded.width * decoded.height > MAX_EDITOR_TEXTURE_PIXELS
      ) {
        throw new Error(
          `texture dimensions ${decoded.width}x${decoded.height} exceed the editor preview limit`,
        );
      }
      const replaced = this.set({
        name: decoded.name,
        sourceName,
        width: decoded.width,
        height: decoded.height,
        rgba: decoded.levels[0]!.rgba,
        alphaTest: false,
      });
      return {
        sourceName,
        materialName: decoded.name,
        ...(decoded.animationName
          ? { animationName: decoded.animationName }
          : {}),
        surface: {
          contents: decoded.contents,
          flags: decoded.flags,
          value: decoded.value,
        },
        added: replaced ? 0 : 1,
        replaced: replaced ? 1 : 0,
        skipped: 0,
        diagnostics: [],
      };
    } catch (error) {
      return {
        sourceName,
        added: 0,
        replaced: 0,
        skipped: 1,
        diagnostics: [
          {
            severity: "warning",
            sourceName,
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }
}
