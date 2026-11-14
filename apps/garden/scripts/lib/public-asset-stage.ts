import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { PublicAsset } from "../../app/content/public-assets.ts";

export async function withPublicAssetStage<T>(
  assets: PublicAsset[],
  operation: (directory: string) => Promise<T>,
) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "garden-public-assets-"),
  );
  try {
    await fs.chmod(directory, 0o700);
    for (const asset of assets) {
      const target = path.resolve(directory, asset.sourcePath);
      if (!target.startsWith(directory + path.sep))
        throw new Error("Invalid staged asset path");
      const contents = Buffer.from(asset.contents);
      if (
        contents.length !== asset.bytes ||
        createHash("sha256").update(contents).digest("hex") !== asset.hash
      )
        throw new Error("Selected public asset bytes changed before staging");
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, contents, { flag: "wx", mode: 0o400 });
    }
    return await operation(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
