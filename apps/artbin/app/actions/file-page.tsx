import { css, type Handle } from "remix/component";

import type { User } from "#db";

import {
  isTextMimeType,
  type FilePageData,
  type StandardFilePageData,
  type WadTexturePageData,
} from "../data/file-page.ts";
import { mediaFileHref, routes } from "../routes.ts";
import { formatSize } from "../ui/file-collection.tsx";
import { Breadcrumbs } from "../ui/navigation.tsx";
import {
  Badge,
  ButtonLink,
  Detail,
  DetailList,
  Disclosure,
} from "../ui/primitives.tsx";
import { LuckyButton } from "../ui/public/lucky-button.tsx";
import { ModelViewer, type ModelFormat } from "../ui/public/model-viewer.tsx";
import { BspViewer } from "../ui/public/bsp-viewer.tsx";
import { Page } from "../ui/page.tsx";
import { cardStyle, theme } from "../ui/styles.ts";

const pageStyle = css({
  background: theme.color.background,
  marginInline: "auto",
  maxWidth: "1400px",
  minHeight: "calc(100vh - 48px)",
  padding: "1rem",
});
const luckyBarStyle = css({
  alignItems: "center",
  background: theme.color.hover,
  border: `1px solid ${theme.color.borderLight}`,
  display: "flex",
  fontSize: "0.875rem",
  gap: "1rem",
  justifyContent: "space-between",
  marginBottom: "1rem",
  padding: "0.5rem 0.75rem",
  "&:not(:has(button))": { display: "none" },
  "@media (max-width: 640px)": {
    alignItems: "flex-start",
    flexDirection: "column",
  },
});
const contentGridStyle = css({
  display: "grid",
  gap: "1.5rem",
  gridTemplateColumns: "1fr 300px",
  "@media (max-width: 768px)": { gridTemplateColumns: "1fr" },
});
const previewStyle = css({
  alignItems: "center",
  background: "#fafafa",
  border: `1px solid ${theme.color.borderLight}`,
  display: "flex",
  justifyContent: "center",
  minHeight: "300px",
});
const imageStyle = css({
  display: "block",
  maxHeight: "500px",
  maxWidth: "100%",
  objectFit: "contain",
});
const audioPreviewStyle = css({
  padding: "2rem",
  textAlign: "center",
  width: "100%",
});
const largeIconStyle = css({ fontSize: "3rem", marginBottom: "1rem" });
const audioStyle = css({ minWidth: "300px", width: "100%" });
const textPreviewStyle = css({
  background: theme.color.background,
  margin: "1rem",
  maxHeight: "600px",
  overflow: "auto",
  width: "100%",
});
const preStyle = css({
  color: theme.color.text,
  fontFamily: theme.font.mono,
  fontSize: "0.8125rem",
  lineHeight: 1.625,
  margin: 0,
  overflowWrap: "anywhere",
  padding: "0.5rem",
  whiteSpace: "pre-wrap",
});
const detailsStyle = css({ alignSelf: "start" });
const fileNameStyle = css({
  fontWeight: 500,
  margin: "0 0 1rem",
  overflowWrap: "anywhere",
});
const capitalizeStyle = css({ textTransform: "capitalize" });
const breakWordsStyle = css({ overflowWrap: "anywhere" });
const codeStyle = css({ fontSize: "0.75rem" });
const tagsStyle = css({ marginTop: "1rem" });
const subheadingStyle = css({ fontWeight: 500, margin: "0 0 0.5rem" });
const tagsListStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.25rem",
});
const detailsSectionStyle = css({ marginTop: "1rem" });
const relatedListStyle = css({
  fontSize: "0.75rem",
  marginTop: "0.5rem",
  overflowWrap: "anywhere",
});
const downloadStyle = css({ marginTop: "1.5rem" });
const textureHeaderStyle = css({
  alignItems: "flex-start",
  display: "flex",
  gap: "1rem",
  justifyContent: "space-between",
  marginBottom: "1rem",
});
const textureTitleStyle = css({
  fontSize: "1.25rem",
  fontWeight: "normal",
  margin: 0,
});
const texturePreviewStyle = css({
  alignItems: "center",
  background: "#fafafa",
  border: `1px solid ${theme.color.borderLight}`,
  display: "flex",
  justifyContent: "center",
  minHeight: "420px",
  padding: "1.5rem",
});
const textureImageStyle = css({
  display: "block",
  maxHeight: "70vh",
  maxWidth: "100%",
  objectFit: "contain",
});
const downloadStackStyle = css({
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  marginTop: "1.5rem",
});
const fallbackStyle = css({
  background: theme.color.hover,
  padding: "3rem",
  textAlign: "center",
});
const fallbackTitleStyle = css({
  marginBottom: "0.5rem",
  textTransform: "capitalize",
});
const fallbackMessageStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  marginBottom: "1rem",
});

export function FileRoutePage(
  handle: Handle<{ data: FilePageData; user: User }>,
) {
  return () => {
    const { data, user } = handle.props;
    return data.page === "wad-texture" ? (
      <WadTexturePage data={data} user={user} />
    ) : data.page === "file" ? (
      <StandardFilePage data={data} user={user} />
    ) : null;
  };
}

function StandardFilePage(
  handle: Handle<{ data: StandardFilePageData; user: User }>,
) {
  return () => {
    const { data, user } = handle.props;
    const { file } = data;
    const downloadUrl = mediaFileHref(file);
    const displayUrl = mediaFileHref(file, {
      preview: Boolean(file.hasPreview),
    });
    const image = file.kind === "texture";
    const model = file.kind === "model";
    const audio = file.kind === "audio";
    const text = isTextMimeType(file.mimeType);
    const modelFormat = getModelFormat(file.name);
    const bsp = file.kind === "map" && file.name.toLowerCase().endsWith(".bsp");

    return (
      <Page title={`${file.name} - artbin`} user={user}>
        <main mix={pageStyle}>
          <div mix={luckyBarStyle}>
            <LuckyButton
              contextual
              excludeHref={routes.file.href({ path: file.path })}
              historyLabel="Lucky again"
            />
          </div>
          <FileBreadcrumb data={data} />
          <div mix={contentGridStyle}>
            <div mix={previewStyle}>
              {bsp ? (
                <BspViewer
                  bspUrl={downloadUrl}
                  wadUrls={data.bspWadUrls}
                  walkabilityUrl={data.bspWalkabilityUrl ?? undefined}
                  paletteUrl={data.bspPaletteUrl ?? undefined}
                  format={data.bspFormat ?? undefined}
                  gameAssets={data.bspGameAssetUrls}
                  skybox={data.bspSkyboxUrls}
                  sprites={data.bspSpriteUrls}
                  sounds={data.bspSoundUrls}
                  height={560}
                />
              ) : image ? (
                <a href={downloadUrl} target="_blank" rel="noopener">
                  <img
                    src={displayUrl}
                    alt={file.name}
                    mix={imageStyle}
                    style={{ imageRendering: "pixelated" }}
                  />
                </a>
              ) : model ? (
                modelFormat ? (
                  <ModelViewer
                    modelUrl={downloadUrl}
                    textureUrl={data.modelTexture ?? undefined}
                    textures={data.availableTextures}
                    mtlUrl={data.modelMtl ?? undefined}
                    animUrls={data.modelAnimations.map(
                      (animation) => animation.url,
                    )}
                    format={modelFormat}
                    height={450}
                  />
                ) : (
                  <DownloadFallback
                    icon="📦"
                    title="3D model"
                    message="This model format cannot be previewed in the browser."
                    href={downloadUrl}
                  />
                )
              ) : audio && isWebPlayableAudio(file.name) ? (
                <div mix={audioPreviewStyle}>
                  <div mix={largeIconStyle}>🔊</div>
                  <audio controls src={downloadUrl} mix={audioStyle}>
                    Your browser does not support the audio element.
                  </audio>
                </div>
              ) : text && data.textContent !== null ? (
                <div mix={textPreviewStyle}>
                  <pre mix={preStyle}>{data.textContent}</pre>
                </div>
              ) : (
                <DownloadFallback
                  icon={
                    audio
                      ? "🔊"
                      : file.kind === "map"
                        ? "🗺️"
                        : file.kind === "archive"
                          ? "📁"
                          : "📎"
                  }
                  title={
                    data.textTruncated ? "Text file" : (file.kind ?? "File")
                  }
                  message={
                    data.textTruncated
                      ? `This file is too large to preview (${formatSize(file.size)}).`
                      : "This file is available to download."
                  }
                  href={downloadUrl}
                />
              )}
            </div>
            <FileDetails data={data} downloadUrl={downloadUrl} />
          </div>
        </main>
      </Page>
    );
  };
}

function getModelFormat(name: string): ModelFormat | null {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return ["md2", "md5mesh", "ase", "obj", "gltf", "glb"].includes(extension)
    ? (extension as ModelFormat)
    : null;
}

function FileDetails(
  handle: Handle<{ data: StandardFilePageData; downloadUrl: string }>,
) {
  return () => {
    const { data, downloadUrl } = handle.props;
    const { file } = data;
    const bspOverview =
      file.kind === "map" && /\.bsp$/i.test(file.name) && file.hasPreview;
    return (
      <aside mix={[cardStyle, detailsStyle]}>
        <h1 mix={fileNameStyle}>{file.name}</h1>
        <DetailList>
          <Detail label="Kind">
            <span mix={capitalizeStyle}>{file.kind}</span>
          </Detail>
          <Detail label="Size">{formatSize(file.size)}</Detail>
          <Detail label="Type">
            <span mix={breakWordsStyle}>{file.mimeType}</span>
          </Detail>
          {file.width && file.height ? (
            <>
              <Detail label="Dimensions">
                {file.width} × {file.height}
              </Detail>
              <Detail label="Aspect ratio">
                {aspectRatio(file.width, file.height)}
              </Detail>
            </>
          ) : null}
          {file.source ? <Detail label="Source">{file.source}</Detail> : null}
          {file.sourceArchive ? (
            <Detail label="Archive">
              <span mix={breakWordsStyle}>{file.sourceArchive}</span>
            </Detail>
          ) : null}
          <Detail label="Path">
            <code mix={codeStyle}>{file.path}</code>
          </Detail>
        </DetailList>
        {data.tags.length ? (
          <div mix={tagsStyle}>
            <h2 mix={subheadingStyle}>Tags</h2>
            <div mix={tagsListStyle}>
              {data.tags.map((tag) => (
                <Badge key={tag.id}>{tag.name}</Badge>
              ))}
            </div>
          </div>
        ) : null}
        {data.availableTextures.length > 1 ? (
          <div mix={detailsSectionStyle}>
            <Disclosure summary="Related textures">
              <ul mix={relatedListStyle}>
                {data.availableTextures.map((texture) => (
                  <li key={texture.url}>
                    <a href={texture.url}>{texture.name}</a>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        ) : null}
        <div mix={downloadStyle}>
          <ButtonLink href={downloadUrl} variant="primary" download>
            Download original
          </ButtonLink>
          {bspOverview ? (
            <div mix={detailsSectionStyle}>
              <ButtonLink
                href={mediaFileHref(file, { preview: true })}
                download
              >
                Download 2048px overview
              </ButtonLink>
            </div>
          ) : null}
        </div>
      </aside>
    );
  };
}

function FileBreadcrumb(handle: Handle<{ data: StandardFilePageData }>) {
  return () => {
    const { data } = handle.props;
    return (
      <Breadcrumbs
        items={[
          { label: "Folders", href: routes.folders.href() },
          ...data.ancestors.map((ancestor) => ({
            label: ancestor.name,
            href: routes.folder.index.href({ path: ancestor.slug }),
          })),
          ...(data.folder
            ? [
                {
                  label: data.folder.name,
                  href: routes.folder.index.href({ path: data.folder.slug }),
                },
              ]
            : []),
          { label: data.file.name },
        ]}
      />
    );
  };
}

function WadTexturePage(
  handle: Handle<{ data: WadTexturePageData; user: User }>,
) {
  return () => {
    const { data, user } = handle.props;
    const imageUrl = routes.api.wadTexture.href({
      fileId: data.file.id,
      textureIndex: String(data.texture.index),
    });
    const libraryHref = routes.folder.index.href({ path: data.file.path });
    const textureHref = routes.file.href({
      path: `${data.file.path}/${textureFilename(data.texture, data.contents.textures)}`,
    });

    return (
      <Page title={`${data.texture.name} - artbin`} user={user}>
        <main mix={pageStyle}>
          <div mix={luckyBarStyle}>
            <LuckyButton
              contextual
              fallbackWadFileId={data.file.id}
              fallbackSourceLabel={data.file.name}
              excludeHref={textureHref}
              label="Random texture"
              historyLabel="Lucky again"
            />
          </div>
          <Breadcrumbs
            items={[
              { label: "Folders", href: routes.folders.href() },
              ...data.folderTrail.map((folder) => ({
                label: folder.name,
                href: routes.folder.index.href({ path: folder.slug }),
              })),
              { label: data.file.name, href: libraryHref },
              { label: data.texture.name },
            ]}
          />
          <div mix={textureHeaderStyle}>
            <h1 mix={textureTitleStyle}>{data.texture.name}</h1>
          </div>
          <div mix={contentGridStyle}>
            <div mix={texturePreviewStyle}>
              <img
                src={imageUrl}
                alt={data.texture.name}
                mix={textureImageStyle}
                style={{ imageRendering: "pixelated" }}
              />
            </div>
            <aside mix={[cardStyle, detailsStyle]}>
              <h2 mix={fileNameStyle}>Texture details</h2>
              <DetailList>
                <Detail label="Dimensions">
                  {data.texture.width} × {data.texture.height}
                </Detail>
                <Detail label="Transparency">
                  {data.texture.isTransparent ? "Masked" : "Opaque"}
                </Detail>
                <Detail label="Library">
                  <a href={libraryHref}>{data.file.name}</a>
                </Detail>
                <Detail label="Format">{data.contents.version}</Detail>
              </DetailList>
              <div mix={downloadStackStyle}>
                <ButtonLink href={imageUrl} variant="primary" block download>
                  Download PNG
                </ButtonLink>
                <ButtonLink href={mediaFileHref(data.file)} block download>
                  Download original WAD
                </ButtonLink>
              </div>
            </aside>
          </div>
        </main>
      </Page>
    );
  };
}

function DownloadFallback(
  handle: Handle<{
    icon: string;
    title: string;
    message: string;
    href: string;
  }>,
) {
  return () => (
    <div mix={fallbackStyle}>
      <div mix={largeIconStyle}>{handle.props.icon}</div>
      <div mix={fallbackTitleStyle}>{handle.props.title}</div>
      <div mix={fallbackMessageStyle}>{handle.props.message}</div>
      <ButtonLink href={handle.props.href} variant="primary" download>
        Download
      </ButtonLink>
    </div>
  );
}

function isWebPlayableAudio(filename: string): boolean {
  return new Set(["mp3", "ogg", "wav", "m4a", "webm", "aac"]).has(
    filename.split(".").pop()?.toLowerCase() ?? "",
  );
}

function aspectRatio(width: number, height: number): string {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
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
