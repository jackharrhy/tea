import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
export async function reviewSourceFingerprint(root) {
  const repo = resolve(root, "../..");
  const files = [];
  async function collect(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await collect(path);
      else if (item.isFile()) files.push(path);
    }
  }
  for (const name of ["app", "static", "review-peer", "review-gateway"])
    await collect(join(root, name));
  files.push(
    join(root, "worker.ts"),
    join(root, "wrangler.jsonc"),
    join(root, "package.json"),
    join(root, "scripts/build.mjs"),
    join(root, "scripts/review.mjs"),
    join(root, "scripts/review-source.mjs"),
    join(root, "__tests__/issuer.mjs"),
    join(repo, "package-lock.json"),
    join(repo, "packages/dev-auth/server.mjs"),
  );
  const hash = createHash("sha256");
  for (const file of files.toSorted((a, b) => a.localeCompare(b)))
    hash
      .update(relative(root, file))
      .update("\0")
      .update(await readFile(file))
      .update("\0");
  return hash.digest("hex");
}
