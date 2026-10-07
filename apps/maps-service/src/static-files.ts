import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";

const mediaTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export async function serveStaticFile(
  pathname: string,
  root: string,
): Promise<Response | null> {
  const candidate = pathname === "/" ? "index.html" : pathname.slice(1);
  const relative = normalize(candidate).replace(/^(?:\.\.[/\\])+/, "");
  let path = join(root, relative);
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    size = info.size;
  } catch {
    if (extname(relative)) return null;
    path = join(root, "index.html");
    try {
      size = (await stat(path)).size;
    } catch {
      return null;
    }
  }
  return new Response(
    Readable.toWeb(createReadStream(path)) as ReadableStream,
    {
      status: 200,
      headers: {
        "Content-Type": mediaTypes[extname(path)] ?? "application/octet-stream",
        "Content-Length": String(size),
      },
    },
  );
}
