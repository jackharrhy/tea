import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import {
  generatePreview,
  getImageDimensions,
} from "../src/lib/files.server.ts";
import { walToPng } from "../src/lib/game-textures.server.ts";

test("Maps decodes WAL pixels using the supplied PCX palette", async () => {
  const wal = Buffer.alloc(185, 1);
  wal.fill(0, 0, 100);
  wal.write("wall");
  wal.writeUInt32LE(8, 32);
  wal.writeUInt32LE(8, 36);
  [100, 164, 180, 184].forEach((offset, index) =>
    wal.writeUInt32LE(offset, 40 + index * 4),
  );
  const pcx = Buffer.alloc(897);
  pcx[0] = 10;
  pcx[2] = 1;
  pcx[3] = 8;
  pcx[65] = 1;
  pcx[128] = 12;
  pcx.set([12, 34, 56], 129 + 3);
  const png = await walToPng(wal, pcx);
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([8, 8]);
  expect([...data.subarray(0, 4)]).toEqual([12, 34, 56, 255]);
  await expect(walToPng(wal, Buffer.alloc(0))).rejects.toThrow(/PCX/);
  await expect(walToPng(Buffer.alloc(0), pcx)).rejects.toThrow(/WAL/);
});

test("converts an alpha TGA with shell-sensitive characters in its filename", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artbin-tga-"));
  try {
    const source = join(directory, 'texture $HOME `literal` "quoted".tga');
    // Uncompressed 2x1 BGRA, top-left origin, eight alpha bits.
    const header = Buffer.alloc(18);
    header[2] = 2;
    header.writeUInt16LE(2, 12);
    header.writeUInt16LE(1, 14);
    header[16] = 32;
    header[17] = 0x28;
    await writeFile(
      source,
      Buffer.concat([header, Buffer.from([0, 0, 255, 255, 0, 255, 0, 128])]),
    );
    const preview = await generatePreview(source);
    expect(preview.isOk()).toBe(true);
    const dimensions = await getImageDimensions(source);
    expect(dimensions.isOk() && dimensions.value).toEqual({
      width: 2,
      height: 1,
    });
    const pixels = await sharp(await readFile(`${source}.preview.png`))
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect([...pixels]).toEqual([255, 0, 0, 255, 0, 255, 0, 128]);
    await writeFile(source, "not an image");
    expect((await generatePreview(source)).isErr()).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
