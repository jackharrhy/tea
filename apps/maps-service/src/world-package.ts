import { zipSync } from "fflate";
import { gameTreeAssetPath } from "@tea/maps-protocol";

interface WorldPackageAsset {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export function createWorldPackage(
  bspName: string,
  bsp: Uint8Array,
  assets: readonly WorldPackageAsset[],
): Uint8Array {
  if (!/^[a-zA-Z0-9_-]+\.bsp$/.test(bspName)) {
    throw new Error("World package needs a safe BSP filename");
  }
  const files: Record<string, Uint8Array> = { [`maps/${bspName}`]: bsp };
  for (const asset of assets) {
    files[gameTreeAssetPath(asset.name)] = asset.bytes;
  }
  return zipSync(files, { level: 0 });
}
