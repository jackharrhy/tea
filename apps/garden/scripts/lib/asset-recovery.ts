import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function recoveryPath(value: string) {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Unsafe remote recovery path");
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 32 || code === 127)
      throw new Error("Unsafe remote recovery path");
  }
  return value;
}

// Recovery never grants publication approval and never overwrites local files.
async function localTarget(root: string, name: string, create = false) {
  const parts = name.split("/");
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink())
        throw new Error("Refusing symlink in local recovery path");
      if (current !== path.join(root, name) && !stat.isDirectory())
        throw new Error("Recovery parent is not a directory");
      if (current === path.join(root, name) && !stat.isFile())
        throw new Error("Recovery target is not a regular file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (create && current !== path.join(root, name))
        await fs.mkdir(current, { mode: 0o700 });
    }
  }
  return current;
}

export async function recoverMissingAssets(
  options: {
    assetsPath: string;
    remote: string;
    copy: boolean;
    dryRun: boolean;
  },
  execute: (args: string[]) => string,
) {
  const value: unknown = JSON.parse(
    execute(["lsjson", options.remote, "--files-only", "--recursive"]),
  );
  if (!Array.isArray(value))
    throw new Error("Invalid remote recovery inventory");
  const paths = value.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("Path" in entry) ||
      typeof entry.Path !== "string"
    )
      throw new Error("Invalid remote recovery inventory");
    return recoveryPath(entry.Path);
  });
  let root = path.resolve(options.assetsPath);
  try {
    root = await fs.realpath(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const missing: string[] = [];
  for (const name of paths) {
    const target = await localTarget(root, name);
    try {
      await fs.lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(name);
    }
  }
  if (!options.copy || !missing.length)
    return { selected: paths.length, missing };
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), "garden-asset-recovery-"),
  );
  try {
    await fs.chmod(scratch, 0o700);
    const files = path.join(scratch, "files.txt");
    const received = path.join(scratch, "received");
    await fs.mkdir(received, { mode: 0o700 });
    await fs.writeFile(files, missing.join("\n") + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    execute([
      "copy",
      options.remote,
      received,
      "--files-from-raw",
      files,
      "--ignore-existing",
      ...(options.dryRun ? ["--dry-run"] : []),
    ]);
    if (!options.dryRun) {
      await fs.mkdir(root, { recursive: true });
      root = await fs.realpath(root);
      for (const name of missing) {
        const source = await fs.realpath(path.join(received, name));
        if (
          !source.startsWith(received + path.sep) ||
          !(await fs.stat(source)).isFile()
        )
          throw new Error("Unsafe staged recovery file");
        const contents = await fs.readFile(source);
        const target = await localTarget(root, name, true);
        try {
          await fs.writeFile(target, contents, { flag: "wx", mode: 0o600 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
    }
    return { selected: paths.length, missing };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
