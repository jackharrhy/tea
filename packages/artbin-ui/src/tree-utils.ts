import type { FoundArchive, TreeNode } from "./types";

export function buildTree(archives: FoundArchive[]): TreeNode {
  const root: TreeNode = {
    name: "/",
    path: "/",
    children: new Map(),
    archives: [],
  };

  for (const archive of archives) {
    // Split path into parts, excluding the filename
    const parts = (archive.relativePath ?? archive.path)
      .replaceAll("\\", "/")
      .split("/")
      .filter(Boolean);
    parts.pop(); // Remove filename

    let current = root;
    let currentPath = "";

    for (const part of parts) {
      currentPath += "/" + part;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: currentPath,
          children: new Map(),
          archives: [],
        });
      }
      current = current.children.get(part)!;
    }

    current.archives.push(archive);
  }

  return root;
}

export function countArchives(node: TreeNode): number {
  let count = node.archives.length;
  for (const child of node.children.values()) {
    count += countArchives(child);
  }
  return count;
}

export function getAllArchivePaths(node: TreeNode): string[] {
  const paths: string[] = node.archives.map((a) => a.path);
  for (const child of node.children.values()) {
    paths.push(...getAllArchivePaths(child));
  }
  return paths;
}
