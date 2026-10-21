import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

const { downloadFolder } = vi.hoisted(() => ({ downloadFolder: vi.fn() }));
vi.mock("../src/lib/auth.ts", () => ({
  getAuthenticatedClient: async () => ({
    api: {
      getFolder: async () => ({ folder: { name: "My Folder", slug: "my-folder" } }),
      downloadFolder,
    },
  }),
}));

import { pull } from "../src/commands/pull.ts";

afterEach(() => {
  downloadFolder.mockReset();
  vi.restoreAllMocks();
});

test("does not start a download when the destination already exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artbin-pull-"));
  try {
    const destination = join(directory, "My Folder.zip");
    await writeFile(destination, "original");
    await expect(pull({ _: ["pull", "my-folder", directory], json: true })).rejects.toThrow(
      "Use --force",
    );
    expect(downloadFolder).not.toHaveBeenCalled();
    expect(await readFile(destination, "utf8")).toBe("original");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed forced download preserves the existing file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artbin-pull-"));
  try {
    const destination = join(directory, "archive.zip");
    await writeFile(destination, "original");
    downloadFolder.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            controller.error(new Error("Connection dropped"));
          },
        }),
      ),
    );
    await expect(
      pull({ _: ["pull", "my-folder", destination], force: true, json: true }),
    ).rejects.toThrow("Connection dropped");
    expect(await readFile(destination, "utf8")).toBe("original");
    expect(await readdir(directory)).toEqual(["archive.zip"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a successful forced download replaces the file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artbin-pull-"));
  try {
    const destination = join(directory, "archive.zip");
    await writeFile(destination, "original");
    downloadFolder.mockResolvedValue(new Response("replacement"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await pull({ _: ["pull", "my-folder", destination], force: true, json: true });
    expect(await readFile(destination, "utf8")).toBe("replacement");
    expect(await readdir(directory)).toEqual(["archive.zip"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
