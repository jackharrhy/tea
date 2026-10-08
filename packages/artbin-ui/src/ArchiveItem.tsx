import type { ReactNode } from "react";
import type { FoundArchive } from "./types";

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const archiveIcons: Record<string, string> = {
  pak: "📦",
  pk3: "📦",
  wad: "🎮",
  zip: "🗜️",
  bsp: "🗺️",
};

export interface ArchiveItemProps {
  archive: FoundArchive;
  isSelected: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

export function ArchiveItem({
  archive,
  isSelected,
  onToggle,
  children,
}: ArchiveItemProps) {
  return (
    <div
      className={`flex items-start gap-2 mb-1 ${isSelected ? "bg-[#f0f7ff]" : ""}`}
    >
      <input
        type="checkbox"
        className="w-4 h-4 m-0 cursor-pointer accent-text shrink-0"
        checked={isSelected}
        onChange={onToggle}
      />
      <details className="flex-1">
        <summary className="flex items-center gap-2 py-1 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="text-base">
            {archiveIcons[archive.type] ?? "📦"}
          </span>
          <span className="font-medium text-[0.8125rem]">{archive.name}</span>
          <span className="flex items-center gap-2 ml-auto">
            <span className="text-[0.625rem] font-semibold px-1.5 py-0.5 bg-bg-subtle font-mono">
              {archive.type.toUpperCase()}
            </span>
            <span className="text-[0.7rem] text-text-muted">
              {formatSize(archive.size)}
            </span>
            {archive.gameDir && (
              <span className="text-[0.625rem] px-1.5 py-0.5 bg-[#d4edda]">
                {archive.gameDir}
              </span>
            )}
          </span>
        </summary>

        {children && (
          <div className="p-3 mt-1 bg-[#fafafa] border border-border-light">
            {children}
          </div>
        )}
      </details>
    </div>
  );
}
