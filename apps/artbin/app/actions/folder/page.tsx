import { css, type Handle, type RemixNode } from "remix/component";

import type { User } from "#db";

import type {
  DirectoryPageData,
  FolderPageData,
  WadPageData,
} from "../../data/folder-page.ts";
import { mediaFileHref, mediaFolderPreviewHref, routes } from "../../routes.ts";
import { BrowseTabs } from "../../ui/browse-tabs.tsx";
import { FileCollection, formatSize } from "../../ui/file-collection.tsx";
import { InfiniteFiles } from "../../ui/public/infinite-files.tsx";
import { MediaCard } from "../../ui/media-card.tsx";
import { Breadcrumbs } from "../../ui/navigation.tsx";
import {
  Button,
  ButtonLink,
  Detail,
  DetailList,
  Disclosure,
  EmptyState,
  FormField,
  PageHeader,
  SectionHeader,
  SelectInput,
  TextArea,
  TextInput,
} from "../../ui/primitives.tsx";
import { LuckyButton } from "../../ui/public/lucky-button.tsx";
import { Page } from "../../ui/page.tsx";
import { SearchBar } from "../../ui/search-bar.tsx";
import { UploadControl } from "../../ui/public/upload-control.tsx";
import { inputStyle, theme, visuallyHiddenStyle } from "../../ui/styles.ts";

const pageStyle = css({
  background: theme.color.background,
  marginInline: "auto",
  maxWidth: "1400px",
  minHeight: "calc(100vh - 48px)",
  padding: "1rem",
});
const actionsStyle = css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" });
const sourceStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  margin: "0 0 1rem",
});
const sourceLinkStyle = css({ color: theme.color.text, fontWeight: 500 });
const descriptionStyle = css({ color: theme.color.muted, margin: "0 0 1rem" });
const tabsRowStyle = css({
  alignItems: "center",
  display: "flex",
  gap: "1rem",
  justifyContent: "space-between",
});
const manageStyle = css({ marginBottom: "1.25rem" });
const manageGridStyle = css({
  display: "grid",
  gap: "1.5rem",
  gridTemplateColumns: "repeat(2, 1fr)",
  marginTop: "1rem",
  "@media (max-width: 768px)": { gridTemplateColumns: "1fr" },
});
const fullRowStyle = css({
  gridColumn: "span 2",
  "@media (max-width: 768px)": { gridColumn: "span 1" },
});
const inputRowStyle = css({ display: "flex", gap: "0.5rem" });
const growStyle = css({ flex: "1" });
const spacedButtonStyle = css({ marginTop: "0.5rem" });
const sectionStyle = css({ marginBottom: "2rem" });
const foldersGridStyle = css({
  display: "grid",
  gap: "0.5rem",
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
});
const wadPreviewStyle = css({
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  height: "100%",
  width: "100%",
});
const wadPreviewCellStyle = css({
  border: `1px solid ${theme.color.borderLight}`,
  overflow: "hidden",
});
const coverImageStyle = css({
  display: "block",
  height: "100%",
  objectFit: "cover",
  width: "100%",
});
const wadActionsStyle = css({
  alignItems: "center",
  display: "flex",
  gap: "0.5rem",
});
const searchStyle = css({
  alignItems: "center",
  display: "flex",
  gap: "0.5rem",
  marginBottom: "1rem",
});
const searchInputStyle = css({ maxWidth: "20rem", width: "100%" });
const textureGridStyle = css({
  display: "grid",
  gap: "0.5rem",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
});
const wadFactsStyle = css({ marginTop: "2rem" });
const smallCodeStyle = css({ fontSize: "0.75rem" });
const warningListStyle = css({
  background: theme.color.hover,
  border: `1px solid ${theme.color.borderLight}`,
  fontSize: "0.8125rem",
  margin: "0 0 1rem",
  padding: "0.75rem 0.75rem 0.75rem 2rem",
});

export function FolderRoutePage(
  handle: Handle<{ data: FolderPageData; user: User }>,
) {
  return () => {
    const { data, user } = handle.props;
    return data.page === "wad" ? (
      <WadLibraryPage data={data} user={user} />
    ) : (
      <DirectoryPage data={data} user={user} />
    );
  };
}

function DirectoryPage(
  handle: Handle<{ data: DirectoryPageData; user: User }>,
) {
  return () => {
    const { data, user } = handle.props;
    const { folder, files, wadLibraries, fileCounts } = data;
    const baseUrl = routes.folder.index.href({ path: folder.slug });
    const textures = files.filter((file) => file.kind === "texture");
    const models = files.filter((file) => file.kind === "model");
    const maps = files.filter((file) => file.kind === "map");
    const wadIds = new Set(wadLibraries.map((library) => library.id));
    const otherFiles = files.filter(
      (file) =>
        file.kind !== "texture" &&
        file.kind !== "model" &&
        file.kind !== "map" &&
        !wadIds.has(file.id),
    );
    const nextHref = data.searchResults?.nextCursor
      ? folderSearchHref(data, data.searchResults.nextCursor)
      : null;
    const moveTargets = data.allFolders.filter(
      (candidate) =>
        candidate.id !== folder.id &&
        !candidate.slug.startsWith(`${folder.slug}/`),
    );

    return (
      <Page title={`${folder.name} - artbin`} user={user}>
        <main mix={pageStyle}>
          <Breadcrumb items={data.ancestors} current={folder.name} />

          <PageHeader
            title={folder.name}
            actions={
              <div mix={actionsStyle}>
                <ButtonLink
                  href={routes.api.folderDownload.href({ path: folder.slug })}
                  download
                >
                  Download ZIP
                </ButtonLink>
                <UploadControl
                  currentFolder={{
                    id: folder.id,
                    slug: folder.slug,
                    name: folder.name,
                  }}
                  isAdmin={!!user.isAdmin}
                />
              </div>
            }
          />

          {data.remoteImport ? (
            <p mix={sourceStyle}>
              Source:{" "}
              <a
                mix={sourceLinkStyle}
                href={data.remoteImport.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open the original ${providerName(data.remoteImport.provider)} source`}
              >
                {data.remoteImport.title} on{" "}
                {providerName(data.remoteImport.provider)}
              </a>
              {data.remoteImport.author
                ? ` by ${data.remoteImport.author}`
                : ""}
              {data.remoteImport.game ? ` for ${data.remoteImport.game}` : ""}.
            </p>
          ) : null}

          {folder.description ? (
            <p mix={descriptionStyle}>{folder.description}</p>
          ) : null}

          {user.isAdmin ? (
            <AdminFolderControls
              folder={folder}
              action={routes.folder.action.href({ path: folder.slug })}
              moveTargets={moveTargets}
            />
          ) : null}

          <div mix={tabsRowStyle}>
            <BrowseTabs
              baseUrl={baseUrl}
              currentView={data.view}
              counts={{
                folders: fileCounts.folders,
                textures: fileCounts.texture,
                models: fileCounts.model,
                maps: fileCounts.map,
                sounds: fileCounts.audio,
                all: fileCounts.all,
              }}
            />
            {fileCounts.all > 0 ? (
              <LuckyButton folderId={folder.id} sourceLabel={folder.name} />
            ) : null}
          </div>

          {data.view === "folders" ? null : (
            <SearchBar
              action={baseUrl}
              currentView={data.view}
              currentQuery={data.query}
              currentTag={data.tagSlug}
              tags={data.tags}
            />
          )}

          {data.view === "folders" ? (
            <FolderContents
              data={data}
              textures={textures}
              models={models}
              maps={maps}
              otherFiles={otherFiles}
            />
          ) : (
            <InfiniteFiles
              files={data.searchResults?.files ?? []}
              grid={
                data.view === "textures" ||
                data.view === "models" ||
                data.view === "maps"
              }
              showAudioPlayers={data.view === "sounds"}
              nextHref={nextHref}
            />
          )}
        </main>
      </Page>
    );
  };
}

function AdminFolderControls(
  handle: Handle<{
    folder: DirectoryPageData["folder"];
    action: string;
    moveTargets: DirectoryPageData["allFolders"];
  }>,
) {
  return () => {
    const { folder, action, moveTargets } = handle.props;
    return (
      <div mix={manageStyle}>
        <Disclosure summary="Manage folder">
          <div mix={manageGridStyle}>
            <form method="post" action={action}>
              <input type="hidden" name="_action" value="rename" />
              <FormField label="Folder name" htmlFor={`${folder.id}-name`}>
                <div mix={inputRowStyle}>
                  <div mix={growStyle}>
                    <TextInput
                      id={`${folder.id}-name`}
                      name="name"
                      value={folder.name}
                      required
                      fullWidth
                    />
                  </div>
                  <Button type="submit">Rename</Button>
                </div>
              </FormField>
            </form>
            <form method="post" action={action}>
              <input type="hidden" name="_action" value="move" />
              <FormField label="Parent folder" htmlFor={`${folder.id}-parent`}>
                <div mix={inputRowStyle}>
                  <div mix={growStyle}>
                    <SelectInput
                      id={`${folder.id}-parent`}
                      name="newParentId"
                      fullWidth
                    >
                      <option value="" selected={!folder.parentId}>
                        Root level
                      </option>
                      {moveTargets.map((candidate) => (
                        <option
                          key={candidate.id}
                          value={candidate.id}
                          selected={folder.parentId === candidate.id}
                        >
                          {candidate.slug}
                        </option>
                      ))}
                    </SelectInput>
                  </div>
                  <Button type="submit">Move</Button>
                </div>
              </FormField>
            </form>
            <form method="post" action={action} mix={fullRowStyle}>
              <input type="hidden" name="_action" value="update-description" />
              <FormField
                label="Description"
                htmlFor={`${folder.id}-description`}
              >
                <TextArea
                  id={`${folder.id}-description`}
                  name="description"
                  rows={3}
                  fullWidth
                  placeholder="Describe this folder"
                  value={folder.description ?? ""}
                />
              </FormField>
              <div mix={spacedButtonStyle}>
                <Button type="submit">Save description</Button>
              </div>
            </form>
            <form method="post" action={action} mix={fullRowStyle}>
              <input type="hidden" name="_action" value="delete" />
              <FormField
                label="Delete folder"
                htmlFor={`${folder.id}-confirm-delete`}
                hint={`Type “${folder.name}” to permanently delete this folder`}
              >
                <div mix={inputRowStyle}>
                  <div mix={growStyle}>
                    <TextInput
                      id={`${folder.id}-confirm-delete`}
                      name="confirmName"
                      required
                      fullWidth
                    />
                  </div>
                  <Button type="submit" variant="danger">
                    Delete
                  </Button>
                </div>
              </FormField>
            </form>
          </div>
        </Disclosure>
      </div>
    );
  };
}

function FolderContents(
  handle: Handle<{
    data: DirectoryPageData;
    textures: DirectoryPageData["files"];
    models: DirectoryPageData["files"];
    maps: DirectoryPageData["files"];
    otherFiles: DirectoryPageData["files"];
  }>,
) {
  return () => {
    const { data, textures, models, maps, otherFiles } = handle.props;
    const baseUrl = routes.folder.index.href({ path: data.folder.slug });
    return (
      <>
        {data.childFolders.length || data.wadLibraries.length ? (
          <section mix={sectionStyle}>
            <SectionHeader
              title={
                data.childFolders.length && data.wadLibraries.length
                  ? "Folders and WADs"
                  : data.wadLibraries.length
                    ? "WAD libraries"
                    : "Subfolders"
              }
            />
            <div mix={foldersGridStyle}>
              {data.childFolders.map((child) => (
                <FolderCard
                  key={child.id}
                  id={child.id}
                  href={routes.folder.index.href({ path: child.slug })}
                  name={child.name}
                  previewPath={child.previewPath}
                />
              ))}
              {data.wadLibraries.map((library) => (
                <MediaCard
                  key={library.id}
                  href={routes.folder.index.href({ path: library.path })}
                  title={library.name}
                  meta={`${library.version} · ${library.textureCount} ${library.textureCount === 1 ? "texture" : "textures"}`}
                  placeholder="▦"
                  preview={
                    library.previewTextures.length ? (
                      <div mix={wadPreviewStyle}>
                        {library.previewTextures.map((texture) => (
                          <div key={texture.index} mix={wadPreviewCellStyle}>
                            <img
                              mix={coverImageStyle}
                              src={routes.api.wadTexture.href({
                                fileId: library.id,
                                textureIndex: String(texture.index),
                              })}
                              alt={texture.name}
                              loading="lazy"
                              style={{ imageRendering: "pixelated" }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : undefined
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

        {textures.length ? (
          <AssetSection
            title={countLabel(
              textures.length,
              data.fileCounts.texture,
              "texture",
            )}
            viewHref={`${baseUrl}?view=textures`}
            showViewAll={data.fileCounts.texture > textures.length}
          >
            <FileCollection files={textures} grid />
          </AssetSection>
        ) : null}
        {models.length ? (
          <AssetSection
            title={countLabel(models.length, data.fileCounts.model, "model")}
            viewHref={`${baseUrl}?view=models`}
            showViewAll={data.fileCounts.model > models.length}
          >
            <FileCollection files={models} grid />
          </AssetSection>
        ) : null}
        {maps.length ? (
          <AssetSection
            title={countLabel(maps.length, data.fileCounts.map, "map")}
            viewHref={`${baseUrl}?view=maps`}
            showViewAll={data.fileCounts.map > maps.length}
          >
            <FileCollection files={maps} grid />
          </AssetSection>
        ) : null}
        {otherFiles.length ? (
          <AssetSection
            title={`${otherFiles.length} other ${otherFiles.length === 1 ? "file" : "files"}`}
            viewHref={`${baseUrl}?view=all`}
            showViewAll={data.fileCounts.all > data.files.length}
          >
            <FileCollection files={otherFiles} showAudioPlayers />
          </AssetSection>
        ) : null}
        {!data.childFolders.length && !data.files.length ? (
          <EmptyState
            title="This folder is empty"
            description="Upload files or create a subfolder to add content."
          />
        ) : null}
      </>
    );
  };
}

function AssetSection(
  handle: Handle<{
    title: string;
    viewHref: string;
    showViewAll: boolean;
    children?: RemixNode;
  }>,
) {
  return () => (
    <section mix={sectionStyle}>
      <SectionHeader
        title={handle.props.title}
        actions={
          handle.props.showViewAll ? (
            <a href={handle.props.viewHref}>View all</a>
          ) : null
        }
      />
      {handle.props.children}
    </section>
  );
}

function FolderCard(
  handle: Handle<{
    id: string;
    href: string;
    name: string;
    previewPath: string | null;
  }>,
) {
  return () => (
    <MediaCard
      href={handle.props.href}
      title={handle.props.name}
      imageSrc={
        handle.props.previewPath
          ? mediaFolderPreviewHref({
              id: handle.props.id,
              previewPath: handle.props.previewPath,
            })
          : undefined
      }
      imageAlt=""
      placeholder="📁"
    />
  );
}

function WadLibraryPage(handle: Handle<{ data: WadPageData; user: User }>) {
  return () => {
    const { data, user } = handle.props;
    const query = data.query.toLowerCase();
    const textures = data.contents.textures.filter((texture) =>
      texture.name.toLowerCase().includes(query),
    );
    const libraryHref = routes.folder.index.href({ path: data.file.path });

    return (
      <Page title={`${data.file.name} - artbin`} user={user}>
        <main mix={pageStyle}>
          <Breadcrumb items={data.folderTrail} current={data.file.name} />
          <PageHeader
            title={data.file.name}
            description={`${data.contents.version} texture library with ${data.contents.textures.length} ${data.contents.textures.length === 1 ? "texture" : "textures"}`}
            actions={
              <div mix={wadActionsStyle}>
                {data.contents.textures.length ? (
                  <LuckyButton
                    wadFileId={data.file.id}
                    sourceLabel={data.file.name}
                    label="Random texture"
                  />
                ) : null}
                <ButtonLink
                  href={mediaFileHref(data.file)}
                  variant="primary"
                  download
                >
                  Download WAD
                </ButtonLink>
              </div>
            }
          />
          {data.contents.warnings.length ? (
            <Disclosure
              summary={`${data.contents.warnings.length} archive warning${data.contents.warnings.length === 1 ? "" : "s"}`}
            >
              <ul mix={warningListStyle}>
                {data.contents.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${index}`}>{warning.message}</li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
          <form method="get" action={libraryHref} mix={searchStyle}>
            <label mix={visuallyHiddenStyle} htmlFor="wad-search">
              Search WAD textures
            </label>
            <input
              id="wad-search"
              type="search"
              name="q"
              value={data.query}
              mix={[inputStyle, searchInputStyle]}
              placeholder="Search textures"
            />
            <Button type="submit">Search</Button>
            {data.query ? (
              <ButtonLink href={libraryHref} size="small">
                Clear
              </ButtonLink>
            ) : null}
          </form>
          {textures.length ? (
            <div mix={textureGridStyle}>
              {textures.map((texture) => (
                <MediaCard
                  key={texture.index}
                  href={routes.file.href({
                    path: `${data.file.path}/${textureFilename(texture, data.contents.textures)}`,
                  })}
                  imageSrc={routes.api.wadTexture.href({
                    fileId: data.file.id,
                    textureIndex: String(texture.index),
                  })}
                  imageAlt={texture.name}
                  imageFit="contain"
                  imageRendering="pixelated"
                  title={texture.name}
                  meta={`${texture.width} × ${texture.height}`}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No textures match this search"
              description="Try a shorter or different texture name."
            />
          )}
          <div mix={wadFactsStyle}>
            <DetailList>
              <Detail label="Original file">
                <code mix={smallCodeStyle}>{data.file.path}</code>
              </Detail>
              <Detail label="Size">{formatSize(data.file.size)}</Detail>
              <Detail label="Format">{data.contents.version}</Detail>
            </DetailList>
          </div>
        </main>
      </Page>
    );
  };
}

function Breadcrumb(
  handle: Handle<{
    items: Array<{ id: string; name: string; slug: string }>;
    current: string;
  }>,
) {
  return () => (
    <Breadcrumbs
      items={[
        { label: "Folders", href: routes.folders.href() },
        ...handle.props.items.map((item) => ({
          label: item.name,
          href: routes.folder.index.href({ path: item.slug }),
        })),
        { label: handle.props.current },
      ]}
    />
  );
}

function providerName(provider: string): string {
  return provider === "gamebanana"
    ? "GameBanana"
    : provider === "scmapdb"
      ? "SCMapDB"
      : "direct archive";
}

function folderSearchHref(data: DirectoryPageData, cursor: string): string {
  const params = new URLSearchParams({ view: data.view, cursor });
  if (data.query) params.set("q", data.query);
  if (data.tagSlug) params.set("tag", data.tagSlug);
  return `${routes.folder.index.href({ path: data.folder.slug })}?${params}`;
}

function countLabel(visible: number, total: number, noun: string): string {
  const count = Math.max(visible, total);
  return `${visible}${total > visible ? ` of ${total}` : ""} ${count === 1 ? noun : `${noun}s`}`;
}

function textureFilename(
  texture: { index: number; name: string },
  textures: Array<{ index: number; name: string }>,
): string {
  const duplicate = textures.some(
    (candidate) =>
      candidate.index !== texture.index &&
      candidate.name.toLowerCase() === texture.name.toLowerCase(),
  );
  return `${texture.name}${duplicate ? `~${texture.index}` : ""}.png`;
}
