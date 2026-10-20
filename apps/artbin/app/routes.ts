import { form, get, post, route } from "remix/routes";

export const routes = route({
  assets: get("/assets/*path"),
  mediaFile: get("/media/:fileId/*filename"),
  mediaFolderPreview: get("/media/folder/:folderId/*filename"),
  home: get("/"),
  cli: get("/cli"),
  login: get("/login"),
  settings: form("/settings"),
  myUploads: get("/my-uploads"),
  folders: get("/folders"),
  folder: form("/folder/*path"),
  file: get("/file/*path"),
  dev: route("/dev", {
    kitchenSink: get("/kitchen-sink"),
  }),
  auth: route("/auth", {
    fourm: get("/4orm"),
    fourmCallback: get("/4orm/callback"),
    cliAuthorize: get("/cli/authorize"),
    cliCallback: get("/cli/callback"),
    cliRedeem: post("/cli/redeem"),
  }),
  mcp: {
    endpoint: post("/mcp"),
    endpointGet: get("/mcp"),
    protectedResource: get("/.well-known/oauth-protected-resource/mcp"),
  },
  admin: route("/admin", {
    index: get("/"),
    jobs: form("/jobs"),
    import: form("/import"),
    inbox: form("/inbox"),
    archives: form("/archives"),
    scanSettings: form("/scan-settings"),
    users: get("/users"),
    orphans: form("/orphans"),
    mcp: get("/mcp"),
  }),
  api: route("/api", {
    assets: get("/assets"),
    asset: get("/assets/:assetId"),
    assetContent: get("/assets/:assetId/content"),
    assetWad: get("/assets/:assetId/wad"),
    uploads: "/uploads",
    upload: "/uploads/:uploadId",
    commitUpload: post("/uploads/:uploadId/commit"),
    uploadJob: get("/uploads/jobs/:jobId"),
    finalizeUploads: post("/uploads/finalize"),
    extractUpload: post("/uploads/:uploadId/extract"),
    import: post("/import"),
    lucky: post("/lucky"),
    folder: post("/folder"),
    folderMove: post("/folder/move"),
    folderDownload: get("/folder/download/*path"),
    wadTexture: get("/wad/:fileId/texture/:textureIndex"),
    cli: route("/cli", {
      whoami: get("/whoami"),
      foldersGet: get("/folders"),
      foldersPost: post("/folders"),
      folderManage: post("/folder/manage"),
      manifest: post("/manifest"),
    }),
  }),
});

export function mediaFileHref(
  file: { id: string; name: string },
  options: { preview?: boolean; thumbnail?: boolean } = {},
): string {
  const preview = options.preview === true;
  const thumbnail =
    preview && options.thumbnail === true && /\.bsp$/i.test(file.name);
  const href = routes.mediaFile.href({
    fileId: file.id,
    filename: thumbnail
      ? `${file.name}.thumbnail.webp`
      : preview
        ? `${file.name}.preview.png`
        : file.name,
  });
  return thumbnail
    ? `${href}?thumbnail=1`
    : preview
      ? `${href}?preview=1`
      : href;
}

export function mediaBspWalkabilityHref(file: {
  id: string;
  name: string;
}): string {
  return routes.mediaFile.href({
    fileId: file.id,
    filename: file.name.replace(/\.bsp$/i, ".worldview-walkability.json"),
  });
}

export function mediaFolderPreviewHref(folder: {
  id: string;
  previewPath: string;
}): string {
  const filename = folder.previewPath.replaceAll("\\", "/").split("/").at(-1)!;
  return routes.mediaFolderPreview.href({ folderId: folder.id, filename });
}
