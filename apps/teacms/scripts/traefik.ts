import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

type Manifest = { origin: string; aliases: string[] };
const resolver = process.argv[2];
if (!resolver) throw new Error("Pass a certificate resolver name.");
if (!/^[a-z][a-z0-9-]*$/.test(resolver))
  throw new Error("Certificate resolver must be a Traefik identifier.");
const root = resolve("sites");
const routes: { id: string; hosts: string[] }[] = [];
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = JSON.parse(
    await readFile(join(root, entry.name, "site.json"), "utf8"),
  ) as Manifest;
  if (!manifest.origin) throw new Error(`Missing origin for ${entry.name}`);
  routes.push({
    id: entry.name,
    hosts: [
      manifest.origin,
      ...(manifest.aliases ?? []).map((host) => `https://${host}`),
    ].map((origin) => new URL(origin).hostname),
  });
}
console.log("http:\n  routers:");
for (const { id, hosts } of routes) {
  console.log(`    teacms-${id}:`);
  console.log(
    `      rule: ${hosts.map((host) => `Host(\`${host}\`)`).join(" || ")}`,
  );
  console.log("      entryPoints: [websecure]");
  console.log("      service: teacms@docker");
  console.log(`      tls:\n        certResolver: ${resolver}`);
}
