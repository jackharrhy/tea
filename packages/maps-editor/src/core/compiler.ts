import type { MapsGameProfile } from "./game-profiles.js";

export type MapCompilerBackend = "wasm" | "remote";
export type MapCompileQuality = "preview" | "final";
export type MapCompileStatus = "succeeded" | "failed";
export type MapCompileArtifactKind =
  | "bsp"
  | "package"
  | "portal"
  | "leak-path"
  | "log"
  | "other";

export interface MapCompileInputAsset {
  readonly name: string;
  readonly mediaType: string;
  readonly data: ArrayBuffer;
}

export interface MapCompileRequest {
  readonly mapName: string;
  readonly mapText: string;
  readonly quality: MapCompileQuality;
  readonly expectedDocumentRevision: number;
  readonly profileId?: string;
  readonly assets?: readonly MapCompileInputAsset[];
  readonly signal?: AbortSignal;
}

export interface MapCompileDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly stage: string;
  readonly message: string;
  readonly line?: number | undefined;
}

export interface MapCompileArtifact {
  readonly name: string;
  readonly mediaType: string;
  readonly data: ArrayBuffer;
  readonly kind: MapCompileArtifactKind;
  readonly stage?: string | undefined;
}

export interface MapCompileLog {
  readonly stage: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface MapCompileResult {
  readonly backend: MapCompilerBackend;
  readonly status: MapCompileStatus;
  readonly buildId: string;
  readonly sourceDocumentRevision: number;
  readonly diagnostics: readonly MapCompileDiagnostic[];
  readonly artifacts: readonly MapCompileArtifact[];
  readonly logs: readonly MapCompileLog[];
  readonly elapsedMilliseconds: number;
}

export interface MapBuildProfileCapability {
  readonly id: string;
  readonly label: string;
  readonly game: MapsGameProfile;
  readonly qualities: readonly MapCompileQuality[];
  readonly durationHint?: string | undefined;
}

export interface MapLaunchProfileCapability {
  readonly id: string;
  readonly label: string;
  readonly game: MapsGameProfile;
}

export interface MapBuildCapabilities {
  readonly protocolVersion: 1;
  readonly compileProfiles: readonly MapBuildProfileCapability[];
  readonly launchProfiles: readonly MapLaunchProfileCapability[];
}

export interface MapBuildProfileSelection {
  readonly game: MapsGameProfile;
  readonly preferredId?: string;
  readonly quality?: MapCompileQuality;
}

export function selectMapBuildProfile(
  capabilities: MapBuildCapabilities,
  selection: MapBuildProfileSelection,
): MapBuildProfileCapability | undefined {
  const compatible = capabilities.compileProfiles.filter(
    ({ game, qualities }) =>
      game === selection.game &&
      (selection.quality === undefined ||
        qualities.includes(selection.quality)),
  );
  return (
    compatible.find(({ id }) => id === selection.preferredId) ??
    compatible.find(({ id }) => id === "default") ??
    compatible[0]
  );
}

export function selectMapLaunchProfile(
  capabilities: MapBuildCapabilities,
  game: MapsGameProfile,
): MapLaunchProfileCapability | undefined {
  return capabilities.launchProfiles.find((profile) => profile.game === game);
}

const IBSP_MAGIC = 0x50534249;
const QBSP_MAGIC = 0x50534251;
const BSP2_MAGIC = 0x32505342;

export function compiledBspVersion(data: ArrayBuffer): number | "BSP2" | null {
  if (data.byteLength < 4) return null;
  const view = new DataView(data);
  const first = view.getUint32(0, true);
  if ((first === IBSP_MAGIC || first === QBSP_MAGIC) && data.byteLength >= 8) {
    return view.getUint32(4, true);
  }
  return first === BSP2_MAGIC ? "BSP2" : view.getInt32(0, true);
}

const COMPILED_PREVIEW_BSP_VERSIONS = new Set<number | "BSP2">([
  29,
  30,
  38,
  "BSP2",
]);

export function supportsCompiledBspPreview(data: ArrayBuffer): boolean {
  const version = compiledBspVersion(data);
  return version !== null && COMPILED_PREVIEW_BSP_VERSIONS.has(version);
}

export interface MapLaunchRequest {
  readonly buildId: string;
  readonly profileId: string;
  readonly expectedDocumentRevision: number;
  readonly signal?: AbortSignal;
}

export interface MapLaunchResult {
  readonly buildId: string;
  readonly profileId: string;
  readonly sourceDocumentRevision: number;
  readonly launchedAt: number;
}

/** Implementations may host ericw-tools in a worker/WASM module or behind an HTTP build service. */
export interface MapCompiler {
  readonly backend: MapCompilerBackend;
  compile(request: MapCompileRequest): Promise<MapCompileResult>;
}

export interface MapBuildService extends MapCompiler {
  capabilities(signal?: AbortSignal): Promise<MapBuildCapabilities>;
  launch(request: MapLaunchRequest): Promise<MapLaunchResult>;
}
