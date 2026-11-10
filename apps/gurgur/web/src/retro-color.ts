export const RETRO_COLOR_INTERVALS = [31, 63, 31] as const;
const bayer2 = (cellX: number, cellY: number): number =>
  cellX * 2 + cellY * 3 - cellX * cellY * 4;

export function bayer4Index(x: number, y: number): number {
  const wrappedX = ((x % 4) + 4) % 4;
  const wrappedY = ((y % 4) + 4) % 4;
  return (
    bayer2(wrappedX % 2, wrappedY % 2) * 4 +
    bayer2(Math.floor(wrappedX / 2), Math.floor(wrappedY / 2))
  );
}
