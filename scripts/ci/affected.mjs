import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

export function loadWorkspaces(directory = root) {
  return ["apps", "packages"].flatMap((group) =>
    readdirSync(join(directory, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const path = `${group}/${entry.name}`;
        try {
          const manifest = JSON.parse(
            readFileSync(join(directory, path, "package.json"), "utf8"),
          );
          return [{ path, name: manifest.name, manifest }];
        } catch (error) {
          if (error.code === "ENOENT") return [];
          throw error;
        }
      }),
  );
}

export function selectChecks(paths, workspaces) {
  const all = { cms: true, edge: true, shell: true, body: true, mcp: true };
  const byPath = workspaces.toSorted((a, b) => b.path.length - a.path.length);
  const affected = new Set();

  for (const path of paths) {
    if (
      path === "README.md" ||
      path === "AGENTS.md" ||
      path.startsWith("docs/")
    )
      continue;
    if (path.startsWith("scripts/cms/")) {
      affected.add("@tea/cms");
      continue;
    }
    const workspace = byPath.find(
      (item) => path === item.path || path.startsWith(`${item.path}/`),
    );
    if (workspace) {
      if (path.endsWith("/README.md") || path.endsWith("/AGENTS.md")) continue;
      affected.add(workspace.name);
      continue;
    }
    return all;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, manifest } of workspaces) {
      if (affected.has(name)) continue;
      const dependencies = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      };
      if (
        Object.keys(dependencies).some((dependency) => affected.has(dependency))
      ) {
        affected.add(name);
        changed = true;
      }
    }
  }

  return {
    cms: affected.has("@tea/cms"),
    edge: affected.has("@tea/cms-edge"),
    shell: affected.has("@tea/shell-mcp"),
    body: affected.has("@tea/request-body"),
    mcp: affected.has("@tea/mcp"),
  };
}

function changedPaths(base, head) {
  if (!base || /^0+$/.test(base)) throw new Error("No usable base commit");
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", base, head],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || "Could not compare commits");
  return result.stdout.split("\0").filter(Boolean);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  let checks;
  try {
    checks = selectChecks(
      changedPaths(process.env.BASE_SHA, process.env.HEAD_SHA || "HEAD"),
      loadWorkspaces(),
    );
  } catch (error) {
    console.warn(`Could not determine affected workspaces: ${error.message}`);
    checks = { cms: true, edge: true, shell: true, body: true, mcp: true };
  }
  console.log(`Affected checks: ${JSON.stringify(checks)}`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(checks)
        .map(([name, active]) => `${name}=${active}\n`)
        .join(""),
    );
}
