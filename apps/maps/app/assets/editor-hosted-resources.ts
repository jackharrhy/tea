import {
  HostedErrorResponseSchema,
  HostedAssetSearchResponseSchema,
  HostedOkResponseSchema,
  HostedResourceMountedResponseSchema,
  HostedResourceMountsResponseSchema,
  MountHostedAssetRequestSchema,
  isGameTreeAssetPath,
} from "@tea/maps-protocol";

const MAX_RESOURCE_BYTES = 512 * 1024 * 1024;
const kinds: Readonly<Record<string, string>> = {
  wad: "wad",
  lmp: "palette",
  pcx: "palette",
  fgd: "fgd",
  def: "def",
  ent: "ent",
  spr: "sprite",
  png: "png",
  tga: "tga",
  wal_json: "wal_json",
};

export interface ResourceUpload {
  readonly file: File;
  readonly name: string;
  readonly kind: string;
}

function gameAssetName(file: File): string | null {
  const parts = file.webkitRelativePath.split("/");
  const root = parts.findIndex((part) =>
    ["assets", "textures", "env", "pics"].includes(part),
  );
  if (root < 0) return null;
  const name = parts.slice(root + (parts[root] === "assets" ? 1 : 0)).join("/");
  return isGameTreeAssetPath(name) ? name : null;
}

export function resourceUploads(
  files: readonly File[],
  folder: boolean,
): readonly ResourceUpload[] {
  const uploads: ResourceUpload[] = [];
  for (const file of files) {
    const name = folder ? gameAssetName(file) : file.name;
    if (!name) {
      if (folder) continue;
      throw new Error(`Unsupported project resource: ${file.name}`);
    }
    if (
      name.length > 256 ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error(`Unsafe project resource path: ${name}`);
    }
    const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
    const kind = kinds[extension];
    if (
      !kind ||
      (["png", "tga", "wal_json"].includes(kind) && !isGameTreeAssetPath(name))
    ) {
      if (folder) continue;
      throw new Error(`Unsupported project resource: ${name}`);
    }
    if (file.size > MAX_RESOURCE_BYTES)
      throw new Error(`${name} exceeds the 512 MiB project resource limit`);
    uploads.push({ file, name, kind });
  }
  if (uploads.length === 0)
    throw new Error("No supported project resources were selected");
  return uploads;
}

async function hostedResponse<T>(
  response: Response,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = HostedErrorResponseSchema.safeParse(payload);
    throw new Error(
      error.success ? error.data.error : `Request failed (${response.status})`,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success)
    throw new Error("Maps service returned an invalid response");
  return parsed.data;
}

export async function listHostedResources(
  projectId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const response = await fetcher(
    `/api/projects/${encodeURIComponent(projectId)}/resources`,
    { credentials: "same-origin", signal },
  );
  return (await hostedResponse(response, HostedResourceMountsResponseSchema))
    .mounts;
}

export async function uploadHostedResource(
  projectId: string,
  upload: ResourceUpload,
  fetcher: typeof fetch = fetch,
) {
  const query = new URLSearchParams({ name: upload.name, kind: upload.kind });
  const response = await fetcher(
    `/api/projects/${encodeURIComponent(projectId)}/resources/upload?${query}`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "Content-Type": upload.file.type || "application/octet-stream",
      },
      body: upload.file,
    },
  );
  return (await hostedResponse(response, HostedResourceMountedResponseSchema))
    .mount;
}

export async function removeHostedResource(
  projectId: string,
  resourceId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(
    `/api/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}`,
    { method: "DELETE", credentials: "same-origin" },
  );
  await hostedResponse(response, HostedOkResponseSchema);
}

export async function searchHostedAssets(
  query: string,
  cursor: string | null = null,
  fetcher: typeof fetch = fetch,
) {
  const parameters = new URLSearchParams({ q: query.trim(), limit: "20" });
  if (cursor) parameters.set("cursor", cursor);
  const response = await fetcher(`/api/assets/search?${parameters}`, {
    credentials: "same-origin",
  });
  return hostedResponse(response, HostedAssetSearchResponseSchema);
}

export async function mountHostedAsset(
  projectId: string,
  assetId: string,
  fetcher: typeof fetch = fetch,
) {
  const request = MountHostedAssetRequestSchema.parse({ assetId });
  const response = await fetcher(
    `/api/projects/${encodeURIComponent(projectId)}/resources`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  return (await hostedResponse(response, HostedResourceMountedResponseSchema))
    .mount;
}
