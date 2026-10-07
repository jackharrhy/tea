import { z } from "zod";
import { HostedGameSchema } from "@tea/maps-protocol";
import { canEditProject } from "./access-policy.js";
import type { WorldviewUser } from "./database.js";
import { submitHostedBuild } from "./hosted-build-operation.js";
import { ServiceHttpError, MAX_HOSTED_MAP_BYTES } from "./service-http.js";
import type { WorldviewServiceOptions } from "./service-options.js";

interface McpOperation {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: boolean;
  };
  execute(
    options: WorldviewServiceOptions,
    user: WorldviewUser,
    input: unknown,
  ): Promise<unknown>;
}

function operation<T extends z.ZodType>(
  name: string,
  description: string,
  schema: T,
  readOnly: boolean,
  run: (
    options: WorldviewServiceOptions,
    user: WorldviewUser,
    input: z.output<T>,
  ) => unknown | Promise<unknown>,
): McpOperation {
  return {
    name,
    description,
    inputSchema: z.toJSONSchema(schema, { target: "draft-7" }) as Record<
      string,
      unknown
    >,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: readOnly,
      openWorldHint: false,
    },
    execute: async (options, user, input) =>
      run(options, user, schema.parse(input)),
  };
}

const ProjectId = z.string().min(1).max(256);
const MapId = z.string().min(1).max(256);
const Name = z.string().trim().min(1).max(120);

export const mcpOperations = [
  operation(
    "worldview_list_projects",
    "List projects accessible to this 4orm administrator.",
    z.strictObject({}),
    true,
    (options, user) => ({
      projects: options.database.listProjects(user.id),
    }),
  ),
  operation(
    "worldview_create_project",
    "Create a hosted Worldview project owned by this account.",
    z.strictObject({ name: Name, game: HostedGameSchema }),
    false,
    (options, user, input) => ({
      project: options.database.createProject(user.id, input.name, input.game),
    }),
  ),
  operation(
    "worldview_get_project",
    "Inspect one accessible project, its maps, and pinned assets.",
    z.strictObject({ projectId: ProjectId }),
    true,
    (options, user, input) => {
      const project = options.database.project(input.projectId, user.id);
      if (!project) throw new ServiceHttpError(404, "Project not found");
      return {
        project,
        resources: options.database.listResourceMounts(
          input.projectId,
          user.id,
        ),
        assetBytes: options.database.projectAssetBytes(input.projectId),
      };
    },
  ),
  operation(
    "worldview_create_map",
    "Create a map, optionally from caller-supplied .map source.",
    z.strictObject({
      projectId: ProjectId,
      name: Name,
      format: z.enum(["quake", "valve-220"]),
      source: z.string().max(MAX_HOSTED_MAP_BYTES).optional(),
    }),
    false,
    async (options, user, input) => {
      if (!canEditProject(options.database.role(input.projectId, user.id))) {
        throw new ServiceHttpError(403, "Editor access required");
      }
      if (options.database.hasMapNamed(input.projectId, input.name)) {
        throw new ServiceHttpError(409, "A map with this name already exists");
      }
      const source = input.source ?? '{\n"classname" "worldspawn"\n}\n';
      if (Buffer.byteLength(source) > MAX_HOSTED_MAP_BYTES) {
        throw new ServiceHttpError(
          413,
          "Hosted maps are limited to 2 MiB of source",
        );
      }
      const id = options.database.createMapId();
      const snapshot = await options.maps.initialize(id, source);
      const map = options.database.createMap({
        id,
        projectId: input.projectId,
        userId: user.id,
        name: input.name,
        format: input.format,
      });
      return { map: { ...map, ...snapshot } };
    },
  ),
  operation(
    "worldview_get_map",
    "Inspect map metadata and a bounded slice of canonical source.",
    z.strictObject({
      mapId: MapId,
      offset: z.number().int().nonnegative().default(0),
      maxChars: z.number().int().min(1).max(100_000).default(20_000),
    }),
    true,
    async (options, user, input) => {
      const map = options.database.map(input.mapId, user.id);
      if (!map) throw new ServiceHttpError(404, "Map not found");
      const snapshot = await options.maps.snapshot(map.id);
      return {
        map,
        mapVersion: snapshot.mapVersion,
        sourceSha256: snapshot.sourceSha256,
        source: snapshot.source.slice(
          input.offset,
          input.offset + input.maxChars,
        ),
        nextOffset: Math.min(
          snapshot.source.length,
          input.offset + input.maxChars,
        ),
        truncated: input.offset + input.maxChars < snapshot.source.length,
      };
    },
  ),
  operation(
    "worldview_list_builds",
    "List recent builds and diagnostic results for a map.",
    z.strictObject({ mapId: MapId }),
    true,
    (options, user, input) => {
      if (!options.database.map(input.mapId, user.id)) {
        throw new ServiceHttpError(404, "Map not found");
      }
      return {
        builds: options.database.listBuilds(input.mapId, user.id) ?? [],
      };
    },
  ),
  operation(
    "worldview_start_build",
    "Queue a preview or final build of a saved map version.",
    z.strictObject({
      mapId: MapId,
      quality: z.enum(["preview", "final"]),
      expectedMapVersion: z.number().int().nonnegative().optional(),
    }),
    false,
    async (options, user, input) => ({
      build: await submitHostedBuild(options, {
        mapId: input.mapId,
        userId: user.id,
        quality: input.quality,
        ...(input.expectedMapVersion !== undefined
          ? { expectedMapVersion: input.expectedMapVersion }
          : {}),
      }),
    }),
  ),
  operation(
    "worldview_get_build",
    "Inspect one build, its logs, diagnostics, and artifact hashes.",
    z.strictObject({ mapId: MapId, buildId: z.string().min(1).max(256) }),
    true,
    (options, user, input) => {
      const build = options.database.build(input.mapId, input.buildId, user.id);
      if (!build) throw new ServiceHttpError(404, "Build not found");
      return { build };
    },
  ),
  operation(
    "worldview_get_build_artifact",
    "Read a chunk of a completed build artifact as base64 for inspection or download.",
    z.strictObject({
      mapId: MapId,
      buildId: z.string().min(1).max(256),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      offset: z.number().int().nonnegative().default(0),
      maxBytes: z
        .number()
        .int()
        .min(1)
        .max(1024 * 1024)
        .default(256 * 1024),
    }),
    true,
    async (options, user, input) => {
      const build = options.database.build(input.mapId, input.buildId, user.id);
      const artifact = build?.result?.artifacts?.find(
        (item) => item.sha256 === input.sha256,
      );
      if (!artifact)
        throw new ServiceHttpError(404, "Build artifact not found");
      const bytes = await options.blobs.get(input.sha256);
      if (!bytes)
        throw new ServiceHttpError(404, "Build artifact data not found");
      const end = Math.min(bytes.byteLength, input.offset + input.maxBytes);
      return {
        artifact,
        offset: input.offset,
        nextOffset: end,
        complete: end >= bytes.byteLength,
        base64: Buffer.from(bytes.subarray(input.offset, end)).toString(
          "base64",
        ),
      };
    },
  ),
  operation(
    "worldview_create_browser_grant",
    "Create a one-time browser login code for one editable project. Redeem within 10 minutes; browser access lasts one hour.",
    z.strictObject({ projectId: ProjectId }),
    false,
    (options, user, input) => {
      const grant = options.database.createAutomationGrant(
        user.id,
        input.projectId,
      );
      if (!grant)
        throw new ServiceHttpError(403, "Project editor access required");
      return {
        code: grant.code,
        expiresAt: grant.expiresAt,
        redeemUrl: `${options.mcpAuth?.publicUrl}/api/automation/redeem`,
        projectUrl: `${options.mcpAuth?.publicUrl}/project/${input.projectId}`,
      };
    },
  ),
] satisfies readonly McpOperation[];

export const mcpOperationsByName = new Map(
  mcpOperations.map((tool) => [tool.name, tool]),
);

export const mcpToolDescriptions = mcpOperations.map(
  ({ name, description, inputSchema, annotations }) => ({
    name,
    description,
    inputSchema,
    annotations,
  }),
);
