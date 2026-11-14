import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dependencyClosure } from "./publish-impact.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
export const nodeImageApps = [
  "cms",
  "auth",
  "artbin",
  "letters-to-steve",
  "marky",
  "maps-service",
  "maps-compiler",
  "rotund",
  "8mb",
];

// Image checks intentionally have stricter root gates than publication. Root
// scripts/config can bootstrap builds without being manifest dependencies.
export function selectNodeImages({
  paths,
  beforeLock,
  afterLock,
  dockerfiles,
}) {
  if (!paths.length) return [];
  if (paths.some((path) => !/^(apps|packages)\/[^/]+\/.+/.test(path)))
    return [...nodeImageApps];
  for (const lock of [beforeLock, afterLock]) {
    if (!lock?.packages?.[""]) throw new Error("Missing root lock entry");
    for (const app of nodeImageApps)
      if (!lock.packages[`apps/${app}`])
        throw new Error(`Missing lock entry for ${app}`);
  }
  const workspaces = paths.map((path) => path.split("/").slice(0, 2).join("/"));
  if (
    workspaces.some(
      (workspace) =>
        !beforeLock.packages[workspace] && !afterLock.packages[workspace],
    )
  )
    return [...nodeImageApps];
  return nodeImageApps.filter((app) => {
    const dockerfile = dockerfiles[app];
    if (typeof dockerfile !== "string")
      throw new Error(`Missing Dockerfile for ${app}`);
    // COPY inputs need not be dependencies. In particular COPY . . in CMS
    // and both maps images makes every workspace file an image input.
    // Unsupported COPY syntax conservatively selects the image.
    for (const line of dockerfile.split("\n")) {
      if (!/^\s*(?:COPY|ADD)\s/i.test(line) || /--from[=\s]/i.test(line))
        continue;
      const args = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .filter((arg) => !arg.startsWith("--"));
      const sources = args
        .slice(0, -1)
        .map((source) => source.replace(/^\.\//, ""));
      if (sources.some((source) => source === "." || source === ""))
        return true;
      if (
        !sources.length ||
        sources.some((source) => /[[\]"'$*?\\]/.test(source))
      )
        return true;
      if (
        sources.some((source) =>
          paths.some(
            (path) =>
              path === source ||
              path.startsWith(`${source.replace(/\/$/, "")}/`),
          ),
        )
      )
        return true;
    }
    // The closure includes the app itself and app/package consumers. Both
    // revisions matter when a dependency is removed.
    return [beforeLock, afterLock].some((lock) => {
      const closure = dependencyClosure(lock, app);
      return workspaces.some((workspace) => closure.has(workspace));
    });
  });
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || "Git comparison failed");
  return result.stdout;
}

// Comparison and parse failures must run checks, never omit them.
export function selectNodeImagesFromCommits({
  before,
  head = "HEAD",
  event,
  read = git,
  warn = console.warn,
}) {
  if (event === "workflow_dispatch" || !before || /^0+$/.test(before))
    return [...nodeImageApps];
  try {
    const paths = read([
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      before,
      head,
    ])
      .split("\0")
      .filter(Boolean);
    if (!paths.length) return [];
    const json = (commit) =>
      JSON.parse(read(["show", `${commit}:package-lock.json`]));
    return selectNodeImages({
      paths,
      beforeLock: json(before),
      afterLock: json(head),
      dockerfiles: Object.fromEntries(
        nodeImageApps.map((app) => [
          app,
          [before, head]
            .map((commit) => read(["show", `${commit}:apps/${app}/Dockerfile`]))
            .join("\n"),
        ]),
      ),
    });
  } catch (error) {
    warn(
      `Could not determine affected Node images; checking all: ${error.message}`,
    );
    return [...nodeImageApps];
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const selected = selectNodeImagesFromCommits({
    before: process.env.BASE_SHA,
    head: process.env.HEAD_SHA || "HEAD",
    event: process.env.EVENT,
  });
  const output = `apps=${JSON.stringify(selected)}\n`;
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
}
