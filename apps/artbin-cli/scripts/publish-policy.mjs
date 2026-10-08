export function parseOptions(args, version) {
  let dryRun = false;
  let tag = "latest";
  let explicitTag = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--tag" || arg.startsWith("--tag=")) {
      tag = arg === "--tag" ? args[++index] : arg.slice(6);
      explicitTag = true;
      if (!tag || !/^[a-z][a-z0-9-]*$/.test(tag))
        throw new Error("--tag requires an npm tag such as next or latest.");
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (version.includes("-") && (!explicitTag || tag === "latest")) {
    throw new Error("Prereleases require an explicit non-latest --tag.");
  }
  return { dryRun, tag };
}

export function validatePack(packed, manifest) {
  if (
    !packed ||
    packed.name !== manifest.name ||
    packed.version !== manifest.version
  ) {
    throw new Error("npm packed an unexpected package or version.");
  }
  const paths = packed.files.map((file) => file.path);
  for (const required of [
    "dist/index.js",
    "package.json",
    "README.md",
    "LICENSE",
  ]) {
    if (!paths.includes(required))
      throw new Error(`Package is missing ${required}.`);
  }
  if (manifest.bin?.artbin !== "./dist/index.js")
    throw new Error("Unexpected CLI bin entry.");
  const unexpected = paths.filter(
    (path) =>
      !/^dist\/.*\.js$/.test(path) &&
      !["package.json", "README.md", "LICENSE"].includes(path),
  );
  if (unexpected.length)
    throw new Error(`Unexpected package files: ${unexpected.join(", ")}`);
  if (
    Object.keys(manifest.dependencies ?? {}).length ||
    Object.keys(manifest.optionalDependencies ?? {}).length
  ) {
    throw new Error("The CLI must bundle its runtime dependencies.");
  }
}
