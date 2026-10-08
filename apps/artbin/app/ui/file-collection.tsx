import { css, type Handle } from "remix/component";

import { mediaFileHref, routes } from "../routes.ts";
import { MediaCard } from "./media-card.tsx";
import { EmptyState } from "./primitives.tsx";
import { theme } from "./styles.ts";

const gridStyle = css({
  display: "grid",
  gap: "0.5rem",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
});
const listStyle = css({
  background: theme.color.background,
  border: `1px solid ${theme.color.borderLight}`,
});
const listItemStyle = css({
  borderBottom: `1px solid ${theme.color.borderLight}`,
  "&:last-child": { borderBottom: 0 },
});
const listLinkStyle = css({
  alignItems: "center",
  color: "inherit",
  display: "flex",
  gap: "0.75rem",
  padding: "0.75rem",
  textDecoration: "none",
  transition: "background-color 150ms",
  "&:hover": { background: theme.color.hover, textDecoration: "none" },
});
const iconStyle = css({ flexShrink: 0, fontSize: "1.5rem" });
const fileInfoStyle = css({ flex: "1", minWidth: 0 });
const fileNameStyle = css({
  fontWeight: 500,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
const metadataStyle = css({ color: theme.color.muted, fontSize: "0.75rem" });
const playerStyle = css({ padding: "0 0.75rem 0.75rem" });
const audioStyle = css({ height: "2rem", width: "100%" });

export type FileItem = {
  id: string;
  path: string;
  name: string;
  kind: string | null;
  mimeType: string;
  size: number;
  hasPreview?: boolean | null;
  width?: number | null;
  height?: number | null;
};

interface FileCollectionProps {
  files: FileItem[];
  grid?: boolean;
  showAudioPlayers?: boolean;
}

const playableAudio = new Set(["mp3", "ogg", "wav", "m4a", "webm", "aac"]);

export function FileCollection(handle: Handle<FileCollectionProps>) {
  return () => {
    const { files, grid = false, showAudioPlayers = true } = handle.props;
    if (files.length === 0) {
      return (
        <EmptyState
          title="No files found"
          description="Try another view or adjust the current filters."
        />
      );
    }

    return (
      <div>
        {grid ? (
          <div mix={gridStyle}>
            {files.map((file) => (
              <MediaCard
                key={file.id}
                href={routes.file.href({ path: file.path })}
                imageSrc={
                  file.kind === "map" && !file.hasPreview
                    ? undefined
                    : mediaFileHref(file, {
                        preview: Boolean(file.hasPreview),
                        thumbnail: file.kind === "map",
                      })
                }
                imageAlt={file.name}
                title={file.name}
                meta={
                  file.width && file.height
                    ? `${file.width} × ${file.height}`
                    : formatSize(file.size)
                }
              />
            ))}
          </div>
        ) : (
          <div mix={listStyle}>
            {files.map((file) => {
              const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
              const canPlay =
                file.kind === "audio" &&
                showAudioPlayers &&
                playableAudio.has(extension);
              return (
                <div key={file.id} mix={listItemStyle}>
                  <a
                    href={routes.file.href({ path: file.path })}
                    mix={listLinkStyle}
                  >
                    <span mix={iconStyle}>{fileIcon(file.kind)}</span>
                    <div mix={fileInfoStyle}>
                      <div mix={fileNameStyle}>{file.name}</div>
                      <div mix={metadataStyle}>
                        {file.kind} · {formatSize(file.size)}
                      </div>
                    </div>
                  </a>
                  {canPlay ? (
                    <div mix={playerStyle}>
                      <audio
                        controls
                        src={mediaFileHref(file)}
                        preload="none"
                        mix={audioStyle}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };
}

function fileIcon(kind: string | null): string {
  return (
    {
      texture: "🖼️",
      model: "📦",
      audio: "🔊",
      map: "🗺️",
      archive: "📁",
      config: "📄",
    }[kind ?? ""] ?? "📎"
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}
