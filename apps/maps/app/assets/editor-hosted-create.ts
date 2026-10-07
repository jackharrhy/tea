import {
  gameProfileSupportsFaceSyntax,
  parseMapSource,
  worldviewGameProfile,
} from "@tea/maps-editor/core";
import {
  CreateHostedMapRequestSchema,
  CreateHostedProjectRequestSchema,
  HostedErrorResponseSchema,
  HostedMapFormatSchema,
  HostedMapCreatedResponseSchema,
  HostedProjectCreatedResponseSchema,
  type HostedGame,
} from "@tea/maps-protocol";

const MAX_MAP_BYTES = 2 * 1_024 * 1_024;

async function postHosted<T>(
  path: string,
  request: unknown,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
  fetcher: typeof fetch,
): Promise<T> {
  const response = await fetcher(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
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

export async function createHostedProject(
  name: string,
  game: string,
  fetcher: typeof fetch = fetch,
) {
  const request = CreateHostedProjectRequestSchema.parse({ name, game });
  return (
    await postHosted(
      "/api/projects",
      request,
      HostedProjectCreatedResponseSchema,
      fetcher,
    )
  ).project;
}

export async function createHostedMap(
  projectId: string,
  game: HostedGame,
  name: string,
  format: string,
  sourceFile: File | null,
  fetcher: typeof fetch = fetch,
) {
  const selectedFormat = HostedMapFormatSchema.parse(format);
  if (
    !gameProfileSupportsFaceSyntax(worldviewGameProfile(game), selectedFormat)
  ) {
    throw new Error(
      `${worldviewGameProfile(game).label} does not support that map format`,
    );
  }
  if (sourceFile && sourceFile.size > MAX_MAP_BYTES)
    throw new Error("Map files must be at most 2 MiB");
  const source = sourceFile?.size ? await sourceFile.text() : undefined;
  if (source) {
    if (new TextEncoder().encode(source).byteLength > MAX_MAP_BYTES)
      throw new Error("Map files must be at most 2 MiB");
    const document = parseMapSource(source).document;
    const hasFaces = document.entities.some((entity) =>
      entity.primitives.some(
        (primitive) => primitive.kind === "brush" && primitive.faces.length > 0,
      ),
    );
    if (hasFaces && document.faceSyntax !== selectedFormat)
      throw new Error("Map face syntax does not match the selected format");
  }
  const request = CreateHostedMapRequestSchema.parse({
    name,
    format: selectedFormat,
    ...(source ? { source } : {}),
  });
  return (
    await postHosted(
      `/api/projects/${encodeURIComponent(projectId)}/maps`,
      request,
      HostedMapCreatedResponseSchema,
      fetcher,
    )
  ).map;
}
