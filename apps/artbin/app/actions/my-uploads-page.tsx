import { css, type Handle } from "remix/component";

import type { User } from "#db";

import type { MyUploadsPageData } from "../data/my-uploads-page.ts";
import { mediaFileHref, routes } from "../routes.ts";
import { formatSize } from "../ui/file-collection.tsx";
import { MediaCard } from "../ui/media-card.tsx";
import { Tabs } from "../ui/navigation.tsx";
import { Page } from "../ui/page.tsx";
import { EmptyState, PageHeader } from "../ui/primitives.tsx";
import { buttonStyle, pageStyle, theme } from "../ui/styles.ts";

const groupStyle = css({ marginBottom: "1.5rem" });
const folderLabelStyle = css({
  color: theme.color.muted,
  fontSize: "0.75rem",
  margin: "0 0 0.5rem",
});
const moreStyle = css({ marginTop: "1.5rem", textAlign: "center" });
const textureGridStyle = css({
  display: "grid",
  gap: "0.5rem",
  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
  marginBottom: "0.75rem",
});
const fileSizeStyle = css({
  color: theme.color.faint,
  fontSize: "0.75rem",
  margin: 0,
});
const fileRowStyle = css({
  alignItems: "center",
  borderBottom: `1px solid ${theme.color.borderLight}`,
  display: "flex",
  gap: "0.5rem",
  padding: "0.5rem",
});
const fileIconStyle = css({ fontSize: "1.125rem" });
const fileDetailsStyle = css({ flex: "1", minWidth: 0 });
const truncateStyle = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
const linkStyle = css({ display: "block", textDecoration: "none" });

export function MyUploadsPage(
  handle: Handle<{ data: MyUploadsPageData; user: User }>,
) {
  return () => {
    const { data, user } = handle.props;
    const total =
      data.countMap.pending + data.countMap.approved + data.countMap.rejected;
    const grouped = new Map<string, typeof data.files>();
    if (data.status === "approved") {
      for (const file of data.files) {
        const group = grouped.get(file.folderId) ?? [];
        group.push(file);
        grouped.set(file.folderId, group);
      }
    }

    return (
      <Page title="My uploads - artbin" user={user}>
        <main mix={pageStyle}>
          <PageHeader
            title="My uploads"
            description="Track your pending, approved, and rejected files."
          />
          {total === 0 ? (
            <EmptyState
              title="No uploads yet"
              description="Files you add will appear here while they are reviewed."
            />
          ) : (
            <>
              <Tabs
                label="Upload status"
                activeId={data.status}
                items={(["pending", "approved", "rejected"] as const).map(
                  (status) => ({
                    id: status,
                    href: `${routes.myUploads.href()}?status=${status}`,
                    label: status[0]!.toUpperCase() + status.slice(1),
                    count: data.countMap[status],
                  }),
                )}
              />
              {data.files.length === 0 ? (
                <EmptyState title={`No ${data.status} uploads`} />
              ) : data.status === "approved" ? (
                [...grouped].map(([folderId, group]) => (
                  <section key={folderId} mix={groupStyle}>
                    {data.folderMap[folderId] ? (
                      <p mix={folderLabelStyle}>
                        Folder:{" "}
                        <a
                          href={routes.folder.index.href({
                            path: data.folderMap[folderId]!.slug,
                          })}
                        >
                          {data.folderMap[folderId]!.name}
                        </a>
                      </p>
                    ) : null}
                    <UploadFiles files={group} linkable />
                  </section>
                ))
              ) : (
                <UploadFiles files={data.files} linkable={false} />
              )}
              {data.nextCursor ? (
                <div mix={moreStyle}>
                  <a
                    href={`${routes.myUploads.href()}?status=${data.status}&cursor=${data.nextCursor}`}
                    mix={buttonStyle}
                  >
                    Load more
                  </a>
                </div>
              ) : null}
            </>
          )}
        </main>
      </Page>
    );
  };
}

function UploadFiles(
  handle: Handle<{ files: MyUploadsPageData["files"]; linkable: boolean }>,
) {
  return () => {
    const { files, linkable } = handle.props;
    const textures = files.filter((file) => file.kind === "texture");
    const others = files.filter((file) => file.kind !== "texture");
    return (
      <>
        {textures.length ? (
          <div mix={textureGridStyle}>
            {textures.map((file) => (
              <MediaCard
                key={file.id}
                href={
                  linkable ? routes.file.href({ path: file.path }) : undefined
                }
                imageSrc={mediaFileHref(file, {
                  preview: Boolean(file.hasPreview),
                })}
                imageAlt={file.name}
                title={file.name}
                meta={formatSize(file.size)}
              />
            ))}
          </div>
        ) : null}
        {others.map((file) => {
          const contents = (
            <div mix={fileRowStyle}>
              <span mix={fileIconStyle}>{fileIcon(file.kind)}</span>
              <div mix={fileDetailsStyle}>
                <div mix={truncateStyle}>{file.name}</div>
                <div mix={fileSizeStyle}>
                  {file.kind} · {formatSize(file.size)}
                </div>
              </div>
            </div>
          );
          return linkable ? (
            <a
              key={file.id}
              href={routes.file.href({ path: file.path })}
              mix={linkStyle}
            >
              {contents}
            </a>
          ) : (
            <div key={file.id}>{contents}</div>
          );
        })}
      </>
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
