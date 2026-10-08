import { type ReactNode } from "react";
import type { FoundArchive, TreeNode } from "./types";
import { countArchives, getAllArchivePaths } from "./tree-utils";

export interface ScanTreeViewProps {
  node: TreeNode;
  depth?: number;
  selectedPaths: Set<string>;
  onToggleFolder: (paths: string[], selected: boolean) => void;
  renderArchive: (archive: FoundArchive, isSelected: boolean) => ReactNode;
}

export function ScanTreeView({
  node,
  depth = 0,
  selectedPaths,
  onToggleFolder,
  renderArchive,
}: ScanTreeViewProps) {
  const archiveCount = countArchives(node);

  if (archiveCount === 0) return null;

  // Collect path segments that have only one child and no archives
  let displayNode = node;
  let displayPath = node.name;

  while (displayNode.children.size === 1 && displayNode.archives.length === 0) {
    const onlyChild = Array.from(displayNode.children.values())[0];
    displayPath += "/" + onlyChild.name;
    displayNode = onlyChild;
  }

  const hasChildren = displayNode.children.size > 0;
  const hasArchives = displayNode.archives.length > 0;

  // Sort children by name
  const sortedChildren = Array.from(displayNode.children.values()).toSorted(
    (a, b) => a.name.localeCompare(b.name),
  );

  // Sort archives by name
  const sortedArchives = [...displayNode.archives].toSorted((a, b) =>
    a.name.localeCompare(b.name),
  );

  // Calculate folder selection state
  const allPaths = getAllArchivePaths(displayNode);
  const selectedCount = allPaths.filter((p) => selectedPaths.has(p)).length;
  const isAllSelected =
    selectedCount === allPaths.length && allPaths.length > 0;
  const isPartiallySelected =
    selectedCount > 0 && selectedCount < allPaths.length;

  return (
    <div className="flex items-start gap-2">
      <input
        type="checkbox"
        className="w-4 h-4 m-0 cursor-pointer accent-text shrink-0"
        checked={isAllSelected}
        ref={(el) => {
          if (el) el.indeterminate = isPartiallySelected;
        }}
        onChange={() => onToggleFolder(allPaths, !isAllSelected)}
      />
      <details className="flex-1" open>
        <summary className="flex items-center gap-2 py-1.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="text-base">
            {hasChildren || hasArchives ? "📁" : "📂"}
          </span>
          <span className="flex-1 font-mono text-xs break-all">
            {displayPath}
          </span>
          <span className="text-[0.7rem] text-text-muted px-1.5 py-0.5 bg-bg-hover">
            {archiveCount} archive{archiveCount !== 1 ? "s" : ""}
          </span>
        </summary>

        <div className="ml-5 border-l border-border-light pl-3">
          {/* Child folders */}
          {sortedChildren.map((child) => (
            <ScanTreeView
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPaths={selectedPaths}
              onToggleFolder={onToggleFolder}
              renderArchive={renderArchive}
            />
          ))}

          {/* Archives in this folder */}
          {sortedArchives.map((archive) =>
            renderArchive(archive, selectedPaths.has(archive.path)),
          )}
        </div>
      </details>
    </div>
  );
}
