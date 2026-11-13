import { createHash } from "node:crypto";
import { csp } from "remix/middleware/csp";
import { assets } from "../assets.ts";

const browserEntry = await assets.getScriptEntry(
  new URL("./public/entry.js", import.meta.url).href,
);
export const importMapHash = createHash("sha256")
  .update(JSON.stringify(browserEntry.importMap))
  .digest("base64");

export function gardenCsp(development: boolean, assetOrigin: string) {
  return csp({
    policy: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'self'", `'sha256-${importMapHash}'`, "https://gc.zgo.at"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: [
        "'self'",
        "data:",
        "https://unpkg.com",
        "https://excalidraw.com",
      ],
      mediaSrc: ["'self'", "blob:", assetOrigin],
      connectSrc: ["'self'", "https://jackharrhy.goatcounter.com"],
      frameSrc: [
        "'self'",
        "https://www.youtube.com",
        "https://letterbird.co",
        ...(development ? ["https:"] : []),
      ],
      formAction: ["'self'"],
      baseUri: ["'none'"],
      objectSrc: ["'none'"],
    },
  });
}
