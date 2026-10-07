import {
  asArrayBuffer,
  normalizeGameAssetPath,
  WorldviewError,
  type SoundReference,
  type SpriteReference,
} from "../core/index.js";
import type {
  BinarySource,
  FetchLike,
  ProgressDetail,
  WorldSource,
} from "./types.js";

export interface LoadAssetContext {
  readonly fetch: FetchLike;
  readonly signal: AbortSignal;
  readonly progress: (detail: ProgressDetail) => void;
}

export function abortIfNeeded(signal: AbortSignal): void {
  signal.throwIfAborted();
}

async function readResponse(
  response: Response,
  phase: ProgressDetail["phase"],
  label: string,
  context: LoadAssetContext,
): Promise<ArrayBuffer> {
  if (!response.ok)
    throw new WorldviewError(
      "asset-fetch",
      `${label} returned HTTP ${response.status}`,
    );
  const totalHeader = response.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : undefined;
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    abortIfNeeded(context.signal);
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    loaded += result.value.byteLength;
    context.progress({
      phase,
      label,
      loaded,
      ...(total === undefined ? {} : { total }),
    });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export async function readBinarySource(
  source: BinarySource,
  phase: ProgressDetail["phase"],
  label: string,
  context: LoadAssetContext,
): Promise<ArrayBuffer> {
  abortIfNeeded(context.signal);
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    const buffer = asArrayBuffer(source);
    context.progress({
      phase,
      label,
      loaded: buffer.byteLength,
      total: buffer.byteLength,
    });
    return buffer;
  }
  if (source instanceof Blob) {
    const buffer = await source.arrayBuffer();
    abortIfNeeded(context.signal);
    context.progress({
      phase,
      label,
      loaded: buffer.byteLength,
      total: buffer.byteLength,
    });
    return buffer;
  }

  try {
    const response = await context.fetch(source, { signal: context.signal });
    return await readResponse(response, phase, label, context);
  } catch (error) {
    if (context.signal.aborted) throw context.signal.reason;
    if (error instanceof WorldviewError) throw error;
    throw new WorldviewError("asset-fetch", `failed to fetch ${label}`, {
      cause: error,
    });
  }
}

export function assetDirectory(base: string | URL): URL {
  const value =
    base instanceof URL
      ? base
      : new URL(base, globalThis.location?.href ?? "http://localhost/");
  return value.pathname.endsWith("/")
    ? value
    : new URL(`${value.pathname}/`, value);
}

export function sourceBelow(base: string | URL, path: string): URL {
  return new URL(path, assetDirectory(base));
}

export function wadUrl(base: string | URL, basename: string): URL {
  return new URL(encodeURIComponent(basename), assetDirectory(base));
}

function safeAssetUrl(base: string | URL, path: string): URL {
  const safePath = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return new URL(safePath, assetDirectory(base));
}

export function gameAssetUrl(base: string | URL, path: string): URL {
  return safeAssetUrl(base, normalizeGameAssetPath(path));
}

export function spriteUrl(base: string | URL, reference: SpriteReference): URL {
  return safeAssetUrl(base, reference.normalizedPath);
}

export function soundUrl(base: string | URL, reference: SoundReference): URL {
  return safeAssetUrl(base, reference.declaredPath);
}

export function skyboxUrl(
  base: string | URL,
  name: string,
  suffix: string,
): URL {
  const normalizedName = name.replace(/\.[^/.]+$/, "").replace(/_$/, "");
  return new URL(
    `${encodeURIComponent(normalizedName)}${suffix}.tga`,
    assetDirectory(base),
  );
}

/** Applies the usual Quake/GoldSrc game-directory layout. Explicit source options override it. */
export function resolveWorldSource(source: WorldSource): WorldSource {
  if (!source.gameBaseUrl) return source;
  const gameRoot = assetDirectory(source.gameBaseUrl);
  const bsp =
    typeof source.bsp === "string" || source.bsp instanceof URL
      ? new URL(source.bsp, gameRoot)
      : source.bsp;
  return {
    ...source,
    bsp,
    wadBaseUrl: source.wadBaseUrl ?? gameRoot,
    skyboxBaseUrl: source.skyboxBaseUrl ?? sourceBelow(gameRoot, "gfx/env/"),
    spriteBaseUrl: source.spriteBaseUrl ?? gameRoot,
    soundBaseUrl: source.soundBaseUrl ?? sourceBelow(gameRoot, "sound/"),
  };
}
