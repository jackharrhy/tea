import { basename, join } from "node:path";
export function safeUploadPath(root: string, path: string) {
  return !path ||
    path !== basename(path) ||
    /[\\/\0]/.test(path) ||
    path === "." ||
    path === ".."
    ? null
    : join(root, path);
}
