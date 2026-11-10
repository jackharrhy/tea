import { resolve } from "node:path";

export function staticFiles(root: string) {
  const files = new Map<
    string,
    { file: ReturnType<typeof Bun.file>; cache: string }
  >();
  for (const path of new Bun.Glob("**/*").scanSync({
    cwd: root,
    onlyFiles: true,
  })) {
    files.set(`/${path}`, {
      file: Bun.file(resolve(root, path)),
      cache: /-[0-9a-f]{6,}\./i.test(path)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    });
  }
  if (!files.has("/assets/game.js") || !files.has("/assets/game.css"))
    throw new Error("Built frontend missing game assets");

  return (request: Request, pathname: string): Response | null => {
    let path: string;
    try {
      path = decodeURIComponent(pathname);
    } catch {
      return new Response("Bad path", { status: 400 });
    }
    const asset = files.get(path);
    if (!asset) return null;
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    return new Response(request.method === "HEAD" ? null : asset.file, {
      headers: {
        "Content-Type": asset.file.type,
        "Content-Length": String(asset.file.size),
        "Cache-Control": asset.cache,
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
