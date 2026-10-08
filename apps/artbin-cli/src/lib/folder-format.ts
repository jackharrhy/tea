import type { FolderDetail, FolderPlan, FolderSummary } from "./api.ts";

function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatFolderTable(folders: FolderSummary[]): string {
  if (folders.length === 0) return "No folders found.";

  const slugWidth = Math.max(
    "SLUG".length,
    ...folders.map((folder) => folder.slug.length),
  );
  const rows = folders.map(
    (folder) =>
      `${folder.slug.padEnd(slugWidth)}  ${String(folder.totalFileCount).padStart(7)}  ${String(folder.childCount).padStart(8)}`,
  );
  return [
    `${"SLUG".padEnd(slugWidth)}    FILES  CHILDREN`,
    `${"-".repeat(slugWidth)}  ${"-".repeat(7)}  ${"-".repeat(8)}`,
    ...rows,
  ].join("\n");
}

export function formatFolderTree(folders: FolderSummary[]): string {
  if (folders.length === 0) return "No folders found.";

  const byParent = new Map<string | null, FolderSummary[]>();
  const ids = new Set(folders.map((folder) => folder.id));
  for (const folder of folders) {
    const parentId =
      folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(folder);
    byParent.set(parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.toSorted((a, b) => a.name.localeCompare(b.name));
  }

  const lines: string[] = [];
  const visit = (parentId: string | null, prefix: string) => {
    const children = byParent.get(parentId) ?? [];
    children.forEach((folder, index) => {
      const last = index === children.length - 1;
      const branch = last ? "└─" : "├─";
      lines.push(
        `${prefix}${branch} ${folder.name}  ${folder.slug}  (${countLabel(folder.totalFileCount, "file")})`,
      );
      visit(folder.id, `${prefix}${last ? "   " : "│  "}`);
    });
  };
  visit(null, "");
  return lines.join("\n");
}

export function formatFolderDetail(folder: FolderDetail): string {
  const lines = [
    `Name: ${folder.name}`,
    `Slug: ${folder.slug}`,
    `Parent: ${folder.parentSlug ?? "root"}`,
    `Files: ${folder.fileCount} direct, ${folder.totalFileCount} total`,
    `Folders: ${folder.childCount} direct, ${folder.descendantCount} total descendants`,
  ];

  if (folder.description) lines.push(`Description: ${folder.description}`);
  if (folder.source) {
    lines.push(
      `Source: ${folder.source.provider} (${folder.source.sourceUrl})`,
    );
    if (folder.source.author) lines.push(`Author: ${folder.source.author}`);
    if (folder.source.game) lines.push(`Game: ${folder.source.game}`);
  }
  if (folder.children.length > 0) {
    lines.push(
      "",
      "Children:",
      ...folder.children.map((child) => `  ${child.slug}`),
    );
  }

  return lines.join("\n");
}

export function formatFolderPlan(plan: FolderPlan): string {
  if (plan.noOp) {
    return `No changes needed for ${plan.from.slug}.`;
  }

  const verb = plan.operation === "rename" ? "Rename" : "Move";
  return [
    `${verb}: ${plan.from.slug}`,
    `To: ${plan.to.slug}`,
    `Affected: ${countLabel(plan.affected.folders, "folder")}, ${countLabel(plan.affected.files, "file")}`,
  ].join("\n");
}
