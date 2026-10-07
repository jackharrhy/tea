#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

import { parseBsp } from "@tea/maps-renderer/core";

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function corpusFile(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    throw new Error(`unsafe corpus outputPath: ${String(relativePath)}`);
  }
  const filename = resolve(root, normalize(relativePath));
  if (!filename.startsWith(`${root}${sep}`)) {
    throw new Error(
      `corpus outputPath escapes the manifest directory: ${relativePath}`,
    );
  }
  return filename;
}

const manifestPath = resolve(
  process.argv[2] ?? "local/steam-corpus/manifest.json",
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest.records))
  throw new Error("corpus manifest has no records array");
const corpusRoot = dirname(manifestPath);

const formats = {};
const warnings = {};
const failures = [];
for (const record of manifest.records) {
  if (typeof record?.outputPath !== "string") {
    throw new Error("corpus manifest record has no outputPath");
  }
  try {
    const world = parseBsp(
      await readFile(corpusFile(corpusRoot, record.outputPath)),
    );
    increment(formats, world.format);
    for (const warning of world.warnings) increment(warnings, warning.code);
  } catch (error) {
    failures.push({
      outputPath: record.outputPath,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  manifestPath,
  total: manifest.records.length,
  formats,
  warnings,
  failures,
};
const reportPath = join(dirname(manifestPath), "compatibility-report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Checked ${report.total} BSP files`);
for (const [format, count] of Object.entries(formats))
  console.log(`  ${format}: ${count}`);
for (const [warning, count] of Object.entries(warnings))
  console.log(`  warning ${warning}: ${count}`);
if (failures.length > 0) {
  console.error(`Failed to parse ${failures.length} BSP files:`);
  for (const failure of failures)
    console.error(`  ${failure.outputPath}: ${failure.message}`);
  process.exitCode = 1;
} else console.log("All BSP files parsed successfully");
console.log(`Report: ${reportPath}`);
