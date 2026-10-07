export type WorldviewErrorCode =
  | "webgpu-unavailable"
  | "unsupported-bsp"
  | "invalid-data"
  | "asset-fetch"
  | "missing-palette"
  | "gpu-initialization"
  | "audio-unavailable"
  | "device-lost";

export class WorldviewError extends Error {
  public readonly code: WorldviewErrorCode;
  public override readonly cause?: unknown;

  public constructor(
    code: WorldviewErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "WorldviewError";
    this.code = code;
    if (options && "cause" in options) this.cause = options.cause;
  }
}

export function invalidData(message: string): never {
  throw new WorldviewError("invalid-data", message);
}

export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) invalidData(message);
}
