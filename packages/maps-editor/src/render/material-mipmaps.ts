/** Original box-filtered mip chain, built once on upload rather than during rendering. */
export function materialMipmaps(
  width: number,
  height: number,
  rgba: Uint8Array,
): Uint8Array[] {
  const levels = [rgba];
  while (width > 1 || height > 1) {
    const nextWidth = Math.max(1, Math.floor(width / 2));
    const nextHeight = Math.max(1, Math.floor(height / 2));
    const previous = levels[levels.length - 1]!;
    const next = new Uint8Array(nextWidth * nextHeight * 4);
    for (let y = 0; y < nextHeight; y++) {
      for (let x = 0; x < nextWidth; x++) {
        // Area weights include the last row/column of non-power-of-two textures.
        const x0 = (x * width) / nextWidth;
        const x1 = ((x + 1) * width) / nextWidth;
        const y0 = (y * height) / nextHeight;
        const y1 = ((y + 1) * height) / nextHeight;
        const sums = [0, 0, 0, 0];
        for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
          for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
            const weight =
              (Math.min(x1, sx + 1) - Math.max(x0, sx)) *
              (Math.min(y1, sy + 1) - Math.max(y0, sy));
            const offset = (sy * width + sx) * 4;
            const alpha = previous[offset + 3]! / 255;
            for (let c = 0; c < 3; c++)
              sums[c]! += previous[offset + c]! * alpha * weight;
            sums[3]! += previous[offset + 3]! * weight;
          }
        }
        const offset = (y * nextWidth + x) * 4;
        for (let c = 0; c < 3; c++)
          next[offset + c] =
            sums[3]! > 0 ? Math.round((sums[c]! * 255) / sums[3]!) : 0;
        next[offset + 3] = Math.round(sums[3]! / ((x1 - x0) * (y1 - y0)));
      }
    }
    levels.push(next);
    width = nextWidth;
    height = nextHeight;
  }
  return levels;
}
