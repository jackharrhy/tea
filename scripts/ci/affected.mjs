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
  const all = workspaces
    .filter(({ manifest }) => manifest.scripts?.check)
    .map(({ name }) => name)
    .toSorted();
  const byPath = workspaces.toSorted((a, b) => b.path.length - a.path.length);
  const affected = new Set();

  for (const path of paths) {
    if (
      path === "README.md" ||
      path === "AGENTS.md" ||
      path.startsWith("docs/")
    )
      continue;
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

  return all.filter((name) => affected.has(name));
}

export function planChecks(selected, workspaces) {
  const byName = new Map(
    workspaces.map((workspace) => [workspace.name, workspace]),
  );
  const selectedNames = new Set(selected);
  const visiting = new Set();
  const planned = new Set();
  const plan = [];

  function visit(name) {
    if (planned.has(name)) return;
    if (visiting.has(name))
      throw new Error(`Workspace dependency cycle at ${name}`);
    const workspace = byName.get(name);
    if (!workspace) throw new Error(`Unknown workspace ${name}`);
    visiting.add(name);
    const dependencies = {
      ...workspace.manifest.dependencies,
      ...workspace.manifest.devDependencies,
      ...workspace.manifest.optionalDependencies,
      ...workspace.manifest.peerDependencies,
    };
    for (const dependency of Object.keys(dependencies)
      .filter((candidate) => byName.has(candidate))
      .toSorted())
      visit(dependency);
    visiting.delete(name);
    planned.add(name);
    if (selectedNames.has(name)) {
      if (!workspace.manifest.scripts?.check)
        throw new Error(`No check script for ${name}`);
      plan.push({ name, script: "check" });
    } else if (workspace.manifest.scripts?.build) {
      plan.push({ name, script: "build" });
    }
  }

  for (const name of [...selectedNames].toSorted()) visit(name);
  return plan;
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
    const paths = changedPaths(
      process.env.BASE_SHA,
      process.env.HEAD_SHA || "HEAD",
    );
    checks = selectChecks(
      process.env.DRAFT_PR === "true"
        ? paths.filter(
            (path) =>
              path !== ".github/workflows/check.yml" &&
              path !== "scripts/ci/affected.mjs" &&
              path !== "compose.yml",
          )
        : paths,
      loadWorkspaces(),
    );
  } catch (error) {
    console.warn(`Could not determine affected workspaces: ${error.message}`);
    checks = selectChecks(["package-lock.json"], loadWorkspaces());
  }
  console.log(`Affected checks: ${JSON.stringify(checks)}`);
  const mapsHosted = [
    "@tea/maps",
    "@tea/maps-service",
    "@tea/maps-collaboration",
    "@tea/maps-editor",
    "@tea/maps-renderer",
    "@tea/maps-protocol",
  ].some((name) => checks.includes(name));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `selected=${JSON.stringify(checks)}\nany=${checks.length > 0}\nbrowser=${mapsHosted || ["@tea/cms", "@tea/ref", "@tea/radio"].some((name) => checks.includes(name))}\ncms=${checks.includes("@tea/cms")}\nref=${checks.includes("@tea/ref")}\nradio=${checks.includes("@tea/radio")}\nmaps_hosted=${mapsHosted}\n`,
    );
}
