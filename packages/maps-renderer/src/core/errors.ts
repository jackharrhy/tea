export type MapsErrorCode =
  | "webgpu-unavailable"
  | "unsupported-bsp"
  | "invalid-data"
  | "asset-fetch"
  | "missing-palette"
  | "gpu-initialization"
  | "audio-unavailable"
  | "device-lost";

export class MapsError extends Error {
  public readonly code: MapsErrorCode;
  public override readonly cause?: unknown;

  public constructor(
    code: MapsErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "MapsError";
    this.code = code;
    if (options && "cause" in options) this.cause = options.cause;
  }
}

export function invalidData(message: string): never {
  throw new MapsError("invalid-data", message);
}

export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) invalidData(message);
}
