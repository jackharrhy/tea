import { fileURLToPath } from "node:url";
import type { SitePresentation } from "../../../app/site.ts";
import { PublicPage } from "./page.tsx";
export default {
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  Page: PublicPage,
} satisfies SitePresentation;
