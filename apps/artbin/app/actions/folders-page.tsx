import { css, type Handle } from "remix/component";

import type { User } from "#db";

import type { FoldersPageData } from "../data/folders-page.ts";
import { mediaFolderPreviewHref, routes } from "../routes.ts";
import { BrowseTabs } from "../ui/browse-tabs.tsx";
import { InfiniteFiles } from "../ui/public/infinite-files.tsx";
import { MediaCard } from "../ui/media-card.tsx";
import { EmptyState, PageHeader } from "../ui/primitives.tsx";
import { LuckyButton } from "../ui/public/lucky-button.tsx";
import { Page } from "../ui/page.tsx";
import { SearchBar } from "../ui/search-bar.tsx";
import { UploadControl } from "../ui/public/upload-control.tsx";
import { pageStyle } from "../ui/styles.ts";

const tabsRowStyle = css({
  alignItems: "center",
  display: "flex",
  gap: "1rem",
  justifyContent: "space-between",
});
const foldersGridStyle = css({
  display: "grid",
  gap: "0.5rem",
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
});

interface FoldersPageProps {
  data: FoldersPageData;
  user: User;
}

export function FoldersPage(handle: Handle<FoldersPageProps>) {
  return () => {
    const { data, user } = handle.props;
    const search = data.searchResults;
    const nextHref = search?.nextCursor
      ? foldersSearchHref({
          view: data.view,
          query: data.query,
          tag: data.tagSlug,
          cursor: search.nextCursor,
        })
      : null;

    return (
      <Page title="Folders - artbin" user={user}>
        <main mix={pageStyle}>
          <PageHeader
            title="Browse"
            description="Explore folders and files across the archive."
            actions={<UploadControl isAdmin={!!user.isAdmin} label="Add" />}
          />

          <div mix={tabsRowStyle}>
            <BrowseTabs
              baseUrl={routes.folders.href()}
              currentView={data.view}
              counts={data.counts}
            />
            {data.counts.all > 0 ? (
              <LuckyButton sourceLabel="all assets" />
            ) : null}
          </div>

          {data.view === "folders" ? null : (
            <SearchBar
              action={routes.folders.href()}
              currentView={data.view}
              currentQuery={data.query}
              currentTag={data.tagSlug}
              tags={data.tags}
            />
          )}

          {data.view === "folders" ? (
            data.folders.length === 0 ? (
              <EmptyState
                title="No folders yet"
                description="Add the first folder or upload a collection to get started."
              />
            ) : (
              <div mix={foldersGridStyle}>
                {data.folders.map((folder) => {
                  const count = data.folderCounts[folder.id] ?? 0;
                  return (
                    <MediaCard
                      key={folder.id}
                      href={routes.folder.index.href({ path: folder.slug })}
                      imageSrc={
                        folder.previewPath
                          ? mediaFolderPreviewHref({
                              id: folder.id,
                              previewPath: folder.previewPath,
                            })
                          : undefined
                      }
                      imageAlt=""
                      title={folder.name}
                      meta={`${count} ${count === 1 ? "file" : "files"}`}
                    />
                  );
                })}
              </div>
            )
          ) : (
            <InfiniteFiles
              files={search?.files ?? []}
              grid={data.view === "textures" || data.view === "models"}
              showAudioPlayers={data.view === "sounds"}
              nextHref={nextHref}
            />
          )}
        </main>
      </Page>
    );
  };
}

function foldersSearchHref(input: {
  view: string;
  query: string;
  tag: string | null;
  cursor: string;
}): string {
  const params = new URLSearchParams({
    view: input.view,
    cursor: input.cursor,
  });
  if (input.query) params.set("q", input.query);
  if (input.tag) params.set("tag", input.tag);
  return `${routes.folders.href()}?${params}`;
}
