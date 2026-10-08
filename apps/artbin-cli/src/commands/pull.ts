import * as p from "@clack/prompts";
import { createWriteStream } from "fs";
import { access, mkdir, rename, rm, stat } from "fs/promises";
import { basename, dirname, join, resolve, sep } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { getAuthenticatedClient } from "../lib/auth.ts";

function responseFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/i);
  if (!match) return fallback;

  try {
    return basename(decodeURIComponent(match[1]));
  } catch {
    return basename(match[1]);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function destinationPath(
  input: string | undefined,
  filename: string,
): Promise<string> {
  if (!input) return resolve(filename);

  const target = resolve(input);
  try {
    const targetStat = await stat(target);
    return targetStat.isDirectory() ? join(target, filename) : target;
  } catch {
    if (input.endsWith("/") || input.endsWith(sep)) {
      await mkdir(target, { recursive: true });
      return join(target, filename);
    }
    return target;
  }
}

export async function pull(args: Record<string, unknown>) {
  const values = (args._ as string[]) ?? [];
  const slug = values[1];
  const destination = values[2];
  if (!slug) {
    throw new Error(
      "Usage: artbin pull <slug> [destination] [--force] [--json]",
    );
  }

  const { api } = await getAuthenticatedClient();
  const { folder } = await api.getFolder(slug);
  const response = await api.downloadFolder(slug);
  if (!response.body) throw new Error("The server returned an empty download.");

  const fallback = `${folder.slug.split("/").pop() || "folder"}.zip`;
  const outputPath = await destinationPath(
    destination,
    responseFilename(response, fallback),
  );
  if ((await pathExists(outputPath)) && !args.force) {
    throw new Error(
      `File already exists: ${outputPath}. Use --force to replace it.`,
    );
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const partialPath = `${outputPath}.part-${process.pid}`;
  const spinner = p.spinner();
  if (!args.json) spinner.start(`Downloading ${folder.slug}`);

  try {
    await pipeline(
      Readable.fromWeb(
        response.body as import("stream/web").ReadableStream<Uint8Array>,
      ),
      createWriteStream(partialPath, { flags: "wx" }),
    );
    if (args.force && (await pathExists(outputPath))) await rm(outputPath);
    await rename(partialPath, outputPath);
  } catch (error) {
    await rm(partialPath, { force: true });
    if (!args.json) spinner.stop("Download failed");
    throw error;
  }

  const downloaded = await stat(outputPath);
  if (args.json) {
    console.log(
      JSON.stringify(
        { slug: folder.slug, path: outputPath, bytes: downloaded.size },
        null,
        2,
      ),
    );
  } else {
    spinner.stop(`Downloaded ${folder.slug}`);
    p.log.success(outputPath);
  }
}
