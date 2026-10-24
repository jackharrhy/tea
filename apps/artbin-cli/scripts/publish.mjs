import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseOptions, validatePack } from "./publish-policy.mjs";

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(cliDir, "../..");
const registry = "https://registry.npmjs.org/";

function command(
  name,
  args,
  { cwd = root, capture = false, allowFailure = false } = {},
) {
  const result = spawnSync(name, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    env: { ...process.env, npm_config_registry: registry },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${name} ${args.join(" ")} failed\n${result.stderr ?? ""}`);
  }
  return result;
}

function output(name, args, options = {}) {
  return command(name, args, { ...options, capture: true }).stdout.trim();
}

function checkGit(dryRun) {
  const head = output("git", ["rev-parse", "HEAD"]);
  if (output("git", ["status", "--porcelain"])) {
    if (!dryRun)
      throw new Error("Commit and push the working tree before publishing.");
    console.warn("Dry run includes uncommitted changes.");
  }
  if (!dryRun) {
    command("git", ["fetch", "origin"]);
    if (
      output("git", ["branch", "--show-current"]) !== "main" ||
      output("git", ["rev-parse", "origin/main"]) !== head
    ) {
      throw new Error("Publish from main at the commit pushed to origin/main.");
    }
  }
  return head;
}

function checkVersion(name, version) {
  const result = command(
    "npm",
    ["view", `${name}@${version}`, "version", "--json"],
    {
      capture: true,
      allowFailure: true,
    },
  );
  if (result.status === 0)
    throw new Error(
      `${name}@${version} is already published. Bump the CLI version first.`,
    );
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    /* Report the original registry failure below. */
  }
  if (payload?.error?.code !== "E404") {
    throw new Error(
      `Cannot check the npm version: ${result.stderr || result.stdout}`,
    );
  }
}

function login() {
  let result = command("npm", ["whoami"], {
    capture: true,
    allowFailure: true,
  });
  if (result.status !== 0) {
    command("npm", ["login"]);
    result = command("npm", ["whoami"], { capture: true });
  }
  return result.stdout.trim();
}

async function main() {
  const manifest = JSON.parse(
    readFileSync(join(cliDir, "package.json"), "utf8"),
  );
  const { dryRun, tag } = parseOptions(process.argv.slice(2), manifest.version);
  const commit = checkGit(dryRun);
  checkVersion(manifest.name, manifest.version);
  const gitTag = `${manifest.name}@${manifest.version}`;
  if (!dryRun) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error("Publishing requires an interactive terminal.");
    if (
      output("git", ["tag", "--list", gitTag]) ||
      output("git", ["ls-remote", "--tags", "origin", `refs/tags/${gitTag}`])
    ) {
      throw new Error(
        `${gitTag} already exists. Inspect the previous release before continuing.`,
      );
    }
  }

  command("npm", ["ci"]);
  command("npm", ["run", "artbin-cli:release-check"]);
  const scratch = mkdtempSync(join(tmpdir(), "artbin-release-"));
  try {
    const [packed] = JSON.parse(
      output(
        "npm",
        ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch],
        {
          cwd: cliDir,
        },
      ),
    );
    validatePack(packed, manifest);
    const tarball = join(scratch, packed.filename);
    const installDir = join(scratch, "install");
    command(
      "npm",
      [
        "install",
        "--prefix",
        installDir,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        tarball,
      ],
      { cwd: scratch },
    );
    const bin = join(
      installDir,
      "node_modules",
      "@jackharrhy",
      "tea-artbin",
      "dist",
      "index.js",
    );
    if (
      output(process.execPath, [bin, "--version"], { cwd: scratch }) !==
      `artbin ${manifest.version}`
    ) {
      throw new Error("Installed CLI reports the wrong version.");
    }
    command(process.execPath, [bin, "--help"], { cwd: scratch });
    const scanDir = join(scratch, "empty-library");
    mkdirSync(scanDir);
    command(process.execPath, [bin, "scan", scanDir], { cwd: scratch });

    console.log(
      `\nRelease: ${manifest.name}@${manifest.version}\nCommit: ${commit}\nRegistry: ${registry}\nTag: ${tag}\nTarball: ${packed.size} bytes, ${packed.files.length} files\nIntegrity: ${packed.integrity}`,
    );
    if (dryRun) {
      console.log("Dry run complete. Nothing was published or tagged.");
      return;
    }
    console.log(`Publisher: ${login()}`);
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const answer = await prompt.question(
        `Type ${manifest.version} to publish: `,
      );
      if (answer.trim() !== manifest.version)
        throw new Error("Publication cancelled.");
    } finally {
      prompt.close();
    }
    if (checkGit(false) !== commit)
      throw new Error("The release commit changed during validation.");
    command(
      "npm",
      [
        "publish",
        tarball,
        "--ignore-scripts",
        "--access",
        "public",
        "--tag",
        tag,
      ],
      {
        cwd: scratch,
      },
    );
    console.log(
      `Published ${manifest.name}@${manifest.version}. Creating and pushing ${gitTag}…`,
    );
    command("git", ["tag", "-a", gitTag, commit, "-m", gitTag]);
    command("git", ["push", "origin", `refs/tags/${gitTag}`]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Publish stopped: ${error.message}`);
  process.exitCode = 1;
});
