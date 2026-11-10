import { createHash } from "node:crypto";
import { decodeWorldBundle, encodeWorldBundle } from "@tea/gurgur-game";

const worldBundleFile = Bun.file(
  new URL("../../content/generated/systems-garden.bin", import.meta.url),
);
if (!(await worldBundleFile.exists())) {
  throw new Error(
    "compiled Systems Garden bundle is missing; run bun run compile:map",
  );
}

export const WORLD_BUNDLE = decodeWorldBundle(
  await worldBundleFile.arrayBuffer(),
);

const computedRevision = createHash("sha256")
  .update(
    encodeWorldBundle({
      ...WORLD_BUNDLE,
      mapRevision: "0".repeat(64),
    }),
  )
  .digest("hex");

if (computedRevision !== WORLD_BUNDLE.mapRevision) {
  throw new Error("compiled Systems Garden bundle revision mismatch");
}
