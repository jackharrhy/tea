import { readFile, stat } from "node:fs/promises";

export async function readIntrospectionSecret(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > 8192 || (info.mode & 0o077) !== 0)
    throw new Error(
      "Secret must be a regular file with no group/other permissions",
    );
  const value = (await readFile(path, "utf8")).trim();
  if (!value || value.length > 4096)
    throw new Error("Invalid introspection secret file");
  return value;
}
