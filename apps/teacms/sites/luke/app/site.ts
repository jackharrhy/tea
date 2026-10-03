import { fileURLToPath } from "node:url";
import type { SitePresentation } from "@teacms/core/site.ts";
import { PublicPage } from "./page.tsx";
import { NavigationEditor } from "./public/navigation-editor.tsx";
export default {
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  Page: PublicPage,
  NavigationEditor,
} satisfies SitePresentation;
