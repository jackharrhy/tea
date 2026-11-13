import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const globalInputs = new Set([".dockerignore", ".nvmrc"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  return value;
}

function equal(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function dependencies(entry) {
  return dependencyFields.flatMap((field) => Object.keys(entry?.[field] ?? {}));
}

function resolveDependency(packages, from, name) {
  let directory = from;
  for (;;) {
    const candidate = posix.join(directory, "node_modules", name);
    if (packages[candidate]) return candidate;
    if (!directory || directory === ".") return undefined;
    directory = posix.dirname(directory);
  }
}

export function dependencyClosure(lock, app) {
  const packages = lock.packages ?? {};
  const visited = new Map();
  const pending = ["", `apps/${app}`];
  while (pending.length) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    const entry = packages[path];
    if (!entry) {
      visited.set(path, null);
      continue;
    }
    visited.set(path, entry);
    if (entry.link && entry.resolved) pending.push(entry.resolved);
    for (const name of dependencies(entry)) {
      const target = resolveDependency(packages, path, name);
      if (target) pending.push(target);
      else visited.set(`missing:${path}:${name}`, null);
    }
  }
  return visited;
}

function changedRootScripts(before, after) {
  const names = new Set([
    ...Object.keys(before.scripts ?? {}),
    ...Object.keys(after.scripts ?? {}),
  ]);
  return [...names].filter(
    (name) => before.scripts?.[name] !== after.scripts?.[name],
  );
}

function rootWithoutScripts(manifest) {
  const { scripts: _scripts, ...rest } = manifest;
  return rest;
}

export function selectPublishedApps({
  apps,
  paths,
  beforeLock,
  afterLock,
  beforeRoot,
  afterRoot,
  dockerfiles = {},
}) {
  if (paths.some((path) => globalInputs.has(path))) return apps;
  const rootManifestChanged = paths.includes("package.json");
  if (
    rootManifestChanged &&
    !equal(rootWithoutScripts(beforeRoot), rootWithoutScripts(afterRoot))
  )
    return apps;

  const scripts = rootManifestChanged
    ? changedRootScripts(beforeRoot, afterRoot)
    : [];
  const lockChanged = paths.includes("package-lock.json");
  if (lockChanged) {
    const { packages: _beforePackages, ...beforeHeader } = beforeLock;
    const { packages: _afterPackages, ...afterHeader } = afterLock;
    if (!equal(beforeHeader, afterHeader)) return apps;
  }
  return apps.filter((app) => {
    if (paths.some((path) => path.startsWith(`apps/${app}/`))) return true;
    const before = dependencyClosure(beforeLock, app);
    const after = dependencyClosure(afterLock, app);
    for (const path of paths) {
      if (!path.startsWith("packages/")) continue;
      const workspace = path.split("/").slice(0, 2).join("/");
      if (before.has(workspace) || after.has(workspace)) return true;
    }
    if (
      scripts.some((name) =>
        new RegExp(
          `\\b(?:npm|bun) run ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        ).test(dockerfiles[app] ?? ""),
      )
    )
      return true;
    if (!lockChanged) return false;
    const keys = new Set([...before.keys(), ...after.keys()]);
    return [...keys].some((key) => !equal(before.get(key), after.get(key)));
  });
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || "Could not compare commits");
  return result.stdout;
}

function commitJson(commit, path) {
  return JSON.parse(git(["show", `${commit}:${path}`]));
}

export function selectFromCommits(apps, before, head, event) {
  if (event === "workflow_dispatch" || !before || /^0+$/.test(before))
    return apps;
  const paths = git(["diff", "--name-only", "--no-renames", before, head])
    .split("\n")
    .filter(Boolean);
  if (!paths.length) return [];
  const beforeLock = commitJson(before, "package-lock.json");
  const afterLock = commitJson(head, "package-lock.json");
  const beforeRoot = commitJson(before, "package.json");
  const afterRoot = commitJson(head, "package.json");
  const dockerfiles = Object.fromEntries(
    apps.map((app) => [
      app,
      readFileSync(join(root, "apps", app, "Dockerfile"), "utf8"),
    ]),
  );
  return selectPublishedApps({
    apps,
    paths,
    beforeLock,
    afterLock,
    beforeRoot,
    afterRoot,
    dockerfiles,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const apps = process.argv.slice(2);
  if (!apps.length) throw new Error("Pass at least one app");
  const selected = selectFromCommits(
    apps,
    process.env.BEFORE,
    process.env.GITHUB_SHA || "HEAD",
    process.env.EVENT,
  );
  const output = `apps=${JSON.stringify(selected)}\n`;
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
}
