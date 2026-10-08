export function makeWAD3Texture(name = "VIRTUAL"): Buffer {
  const width = 8;
  const height = 8;
  const mipSizes = [64, 16, 4, 1];
  const textureSize =
    40 + mipSizes.reduce((total, size) => total + size, 0) + 2 + 768;
  const textureOffset = 12;
  const directoryOffset = textureOffset + textureSize;
  const buffer = Buffer.alloc(directoryOffset + 32);

  buffer.write("WAD3", 0, "ascii");
  buffer.writeInt32LE(1, 4);
  buffer.writeInt32LE(directoryOffset, 8);
  buffer.write(name, textureOffset, 16, "ascii");
  buffer.writeUInt32LE(width, textureOffset + 16);
  buffer.writeUInt32LE(height, textureOffset + 20);
  buffer.writeUInt32LE(40, textureOffset + 24);
  buffer.writeUInt32LE(104, textureOffset + 28);
  buffer.writeUInt32LE(120, textureOffset + 32);
  buffer.writeUInt32LE(124, textureOffset + 36);

  const pixelsOffset = textureOffset + 40;
  buffer.fill(
    1,
    pixelsOffset,
    pixelsOffset + mipSizes.reduce((total, size) => total + size, 0),
  );
  const paletteCountOffset =
    pixelsOffset + mipSizes.reduce((total, size) => total + size, 0);
  buffer.writeUInt16LE(256, paletteCountOffset);
  const paletteOffset = paletteCountOffset + 2;
  buffer.set([255, 0, 0], paletteOffset + 3);

  buffer.writeInt32LE(textureOffset, directoryOffset);
  buffer.writeInt32LE(textureSize, directoryOffset + 4);
  buffer.writeInt32LE(textureSize, directoryOffset + 8);
  buffer[directoryOffset + 12] = 0x43;
  buffer.write(name, directoryOffset + 16, 16, "ascii");
  return buffer;
}
