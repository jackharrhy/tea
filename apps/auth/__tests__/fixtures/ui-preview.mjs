// Synthetic, read-only UI. No provider, credentials, sessions or database.
import "remix/node-tsx";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
// Never inherit a host appearance-file path, even when launched from an operator shell.
delete process.env.DOODLE_POOL_FILE;
delete process.env.RADIO_ENROLLMENT_DB_FILE;
const { renderLogin } = await import("../../src/login-page.tsx");
const { renderInterior } = await import("./interior.tsx");
const { optionsFrom, renderExplorer } = await import("./explorer.tsx");
const server = createServer(async (req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  const url = new URL(req.url, "http://fixture.invalid");
  const path = url.pathname;
  if (path.startsWith("/assets/")) {
    const asset = path.slice(8);
    if (!/^[a-z0-9/.-]+$/.test(asset) || asset.includes("..")) {
      res.writeHead(404).end();
      return;
    }
    try {
      const file =
        asset === "fixture-explorer.mjs"
          ? new URL("./explorer.mjs", import.meta.url)
          : asset === "doodle-spec.mjs"
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
      res.setHeader("Cache-Control", "no-store");
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
    return;
  }
  if (path !== "/" && path !== "/login") {
    res.writeHead(404).end();
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.setHeader("Cache-Control", "no-store");
  if (path === "/") {
    res.end(await renderInterior());
    return;
  }
  const options = optionsFrom(url.searchParams);
  let html = await renderLogin(
    { csrf: "fixture-only", returnTo: "/" },
    "fixture",
  );
  html = html.replace(/<svg class="auth-art"[\s\S]*?<\/svg>/, "");
  html = html.replace(
    "/assets/doodle-motion.mjs",
    "/assets/fixture-explorer.mjs",
  );
  html = html.replace(
    '<form method="post" action="/login"',
    '<form method="get" action="/login" data-fixture-login="true"',
  );
  html = html.replace("</body>", `${await renderExplorer(options)}</body>`);
  res.end(html);
});
server.listen(Number(process.env.PORT || 18809), "127.0.0.1", () =>
  console.log(
    `Synthetic Auth preview http://127.0.0.1:${server.address().port}`,
  ),
);
