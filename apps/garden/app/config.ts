import path from "node:path";

export function gardenConfig() {
  const development = process.env.NODE_ENV === "development";
  if (!development && !process.env.GARDEN_CONTENT_PATH)
    throw new Error(
      "Production requires GARDEN_CONTENT_PATH pointing to a published snapshot, not the personal vault.",
    );
  return {
    development,
    directory: path.resolve(
      development
        ? process.env.GARDEN_VAULT_PATH || "./vault/Garden"
        : process.env.GARDEN_CONTENT_PATH!,
    ),
    assetsDirectory: path.resolve(
      process.env.GARDEN_VAULT_ASSETS_PATH || "./vault/Assets",
    ),
    origin: process.env.GARDEN_ORIGIN || "https://jackharrhy.dev",
    assetOrigin:
      process.env.GARDEN_ASSET_ORIGIN || "https://garden.jack.camera",
    lastfmKey: process.env.JACKHARRHY_LASTFM_API_KEY,
  };
}
export type GardenConfig = ReturnType<typeof gardenConfig>;
