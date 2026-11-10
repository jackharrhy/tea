/** Packet delays must not change the tick offset within an authority epoch. */
export class SourceTickMapper {
  static readonly MAX_FUTURE_LEAD_TICKS = 12;

  #offset: number | null = null;
  #lastSourceTick: number | null = null;

  map(sourceTick: number, authorityTick: number): number {
    assertTick32(sourceTick, "source tick");
    if (!Number.isSafeInteger(authorityTick) || authorityTick < 0)
      throw new Error("authority tick must be a non-negative safe integer");
    const unwrappedSource =
      this.#lastSourceTick === null
        ? sourceTick
        : unwrapTick32(sourceTick, this.#lastSourceTick);
    if (this.#lastSourceTick !== null && unwrappedSource < this.#lastSourceTick)
      throw new Error("source tick moved backwards");
    this.#offset ??= authorityTick - unwrappedSource;
    const mapped = unwrappedSource + this.#offset;
    if (mapped > authorityTick + SourceTickMapper.MAX_FUTURE_LEAD_TICKS)
      throw new Error("source tick is implausibly far ahead of authority");
    this.#lastSourceTick = unwrappedSource;
    return mapped >>> 0;
  }

  reset(): void {
    this.#offset = null;
    this.#lastSourceTick = null;
  }
}

export function unwrapTick32(tick: number, reference: number): number {
  assertTick32(tick, "tick");
  if (!Number.isSafeInteger(reference))
    throw new Error("tick reference must be a safe integer");
  const referenceLow = reference >>> 0;
  const difference = (tick - referenceLow) | 0;
  return reference + difference;
}

function assertTick32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new Error(`${label} must be an unsigned 32-bit integer`);
}
