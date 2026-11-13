// Synthetic, read-only UI. No provider, credentials, sessions or database.
import "remix/node-tsx";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const { renderLogin } = await import("../../src/login-page.tsx");
const { renderInterior } = await import("./interior.tsx");
const server = createServer(async (req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  const path = new URL(req.url, "http://fixture.invalid").pathname;
  if (path.startsWith("/assets/")) {
    const asset = path.slice(8);
    if (!/^[a-z0-9/.-]+$/.test(asset) || asset.includes("..")) {
      res.writeHead(404).end();
      return;
    }
    try {
      const file =
        asset === "doodle-spec.mjs"
          ? new URL("../../src/doodles.mjs", import.meta.url)
          : asset === "style.css"
            ? new URL("../../src/styles.css", import.meta.url)
            : new URL(`../../public/${asset}`, import.meta.url);
      res.setHeader(
        "Content-Type",
        asset.endsWith(".css")
          ? "text/css"
          : asset.endsWith(".mjs")
            ? "text/javascript"
            : "font/woff2",
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    path === "/login"
      ? await renderLogin({ csrf: "fixture-only", returnTo: "/" }, "fixture")
      : await renderInterior(),
  );
});
server.listen(Number(process.env.PORT || 18809), "127.0.0.1", () =>
  console.log(
    `Synthetic Auth preview http://127.0.0.1:${server.address().port}`,
  ),
);
