import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRouter } from "remix/router";
import { staticFiles } from "remix/middleware/static";
import { render } from "remix/middleware/render";
import { editorDocument } from "./ui/editor.tsx";

type Manifest = Record<string, { file: string }>;

export function createEditorRouter(dist: string) {
  const manifest = JSON.parse(
    readFileSync(join(dist, "8mb/.vite/manifest.json"), "utf8"),
  ) as Manifest;
  const entry = manifest["src/main.ts"];
  if (!entry?.file || !entry.file.startsWith("assets/"))
    throw new Error("Missing built 8mb browser entry");
  const router = createRouter({
    middleware: [staticFiles(dist, { index: false }), render()],
  });
  router.get("/8mb/", (context) =>
    context.render(editorDocument(`/8mb/${entry.file}`)),
  );
  router.get(
    "/8mb",
    () => new Response(null, { status: 308, headers: { Location: "/8mb/" } }),
  );
  router.get(
    "/",
    () => new Response(null, { status: 308, headers: { Location: "/8mb/" } }),
  );
  return router;
}
