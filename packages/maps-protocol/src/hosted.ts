import {
  MapCompileDiagnosticSchema,
  MapCompileLogSchema,
  MapDocumentSchema,
  WorldviewGameProfileSchema,
} from "@tea/maps-editor/core";
import { z } from "zod";

import { ProjectRoleSchema } from "./realtime-ticket.js";

export { MapCompileDiagnosticSchema, MapCompileLogSchema };

const id = z.string().min(1).max(256);
const name = z.string().min(1).max(256);
const timestamp = z.number().int().nonnegative();
const sha256 = z.string().regex(/^[a-f\d]{64}$/i);

export const HostedGameSchema = WorldviewGameProfileSchema.extract([
  "quake",
  "goldsrc",
  "gower",
]);
export type HostedGame = z.infer<typeof HostedGameSchema>;
export const HostedMapFormatSchema = z.enum(["valve-220", "quake"]);

export const HostedSessionUserSchema = z.strictObject({
  id,
  username: z.string().min(1).max(256),
  displayName: name,
  isAdmin: z.boolean(),
});
export type HostedSessionUser = z.infer<typeof HostedSessionUserSchema>;

export const HostedProjectSummarySchema = z.strictObject({
  id,
  slug: z.string().min(1).max(256),
  name,
  game: HostedGameSchema,
  role: ProjectRoleSchema,
  updatedAt: timestamp,
});
export type HostedProjectSummary = z.infer<typeof HostedProjectSummarySchema>;

export const HostedProjectMapSchema = z.strictObject({
  id,
  slug: z.string().min(1).max(256),
  name,
  format: HostedMapFormatSchema,
  updatedAt: timestamp,
});
export type HostedProjectMap = z.infer<typeof HostedProjectMapSchema>;

export const HostedProjectSchema = HostedProjectSummarySchema.extend({
  maps: z.array(HostedProjectMapSchema).max(100_000),
});
export type HostedProject = z.infer<typeof HostedProjectSchema>;

export const HostedProjectAccessUserSchema = z.strictObject({
  id,
  username: z.string().min(1).max(256),
  displayName: name,
  role: ProjectRoleSchema.nullable(),
});
export type HostedProjectAccessUser = z.infer<
  typeof HostedProjectAccessUserSchema
>;

export const HostedResourceMountSchema = z.strictObject({
  id,
  ordinal: z.number().int().nonnegative(),
  provider: z.enum(["artbin", "upload", "worldview"]),
  providerAssetId: id,
  expectedSha256: sha256,
  kind: z.string().min(1).max(128),
  displayName: name,
  size: z.number().int().nonnegative(),
  createdAt: timestamp,
});
export type HostedResourceMount = z.infer<typeof HostedResourceMountSchema>;

export const HostedAssetSchema = z.strictObject({
  id,
  name,
  path: z.string().max(4_096),
  kind: z.string().min(1).max(128),
  mimeType: z.string().min(1).max(256),
  size: z.number().int().nonnegative(),
  sha256: sha256.nullable(),
  width: z.number().int().nonnegative().nullable(),
  height: z.number().int().nonnegative().nullable(),
  folder: z
    .strictObject({ id, name, slug: z.string().min(1).max(256) })
    .nullable(),
  tags: z
    .array(z.strictObject({ id, name, slug: z.string().min(1).max(256) }))
    .max(1_000),
});
export type HostedAsset = z.infer<typeof HostedAssetSchema>;

export const HostedMapSnapshotSchema = z.strictObject({
  mapId: id,
  mapVersion: z.number().int().nonnegative(),
  document: MapDocumentSchema,
  source: z.string().max(8 * 1_024 * 1_024),
  sourceSha256: sha256,
});
export type HostedMapSnapshot = z.infer<typeof HostedMapSnapshotSchema>;

export const HostedMapLaunchSchema = HostedMapSnapshotSchema.extend({
  id,
  slug: z.string().min(1).max(256),
  projectId: id,
  projectSlug: z.string().min(1).max(256),
  projectName: name,
  game: HostedGameSchema,
  name,
  format: HostedMapFormatSchema,
  role: ProjectRoleSchema,
  actorId: id,
  displayName: name,
});
export type HostedMapLaunch = z.infer<typeof HostedMapLaunchSchema>;

export const HostedBuildArtifactSchema = z.strictObject({
  name,
  kind: z.enum(["bsp", "package", "portal", "leak-path", "log", "other"]),
  mediaType: z.string().min(1).max(256),
  sha256,
  size: z.number().int().nonnegative(),
});
export type HostedBuildArtifact = z.infer<typeof HostedBuildArtifactSchema>;

export const HostedBuildResultSchema = z.strictObject({
  error: z.string().max(16_384).optional(),
  diagnostics: z.array(MapCompileDiagnosticSchema).max(10_000).optional(),
  logs: z.array(MapCompileLogSchema).max(1_000).optional(),
  elapsedMilliseconds: z.number().finite().nonnegative().optional(),
  artifacts: z.array(HostedBuildArtifactSchema).max(1_000).optional(),
});
export type HostedBuildResult = z.infer<typeof HostedBuildResultSchema>;

export const HostedBuildSchema = z.strictObject({
  id,
  mapVersion: z.number().int().nonnegative(),
  profileId: id,
  quality: z.enum(["preview", "final"]),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  sourceSha256: sha256.nullable(),
  result: HostedBuildResultSchema.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type HostedBuild = z.infer<typeof HostedBuildSchema>;

export const HostedCheckpointSchema = z.strictObject({
  id,
  name,
  mapVersion: z.number().int().nonnegative(),
  sourceSha256: sha256,
  createdBy: id,
  createdAt: timestamp,
});
export type HostedCheckpoint = z.infer<typeof HostedCheckpointSchema>;

export const HostedErrorResponseSchema = z.strictObject({
  error: z.string().min(1).max(16_384),
});
export const HostedOkResponseSchema = z.strictObject({ ok: z.literal(true) });
export const HostedHealthResponseSchema = z.strictObject({
  status: z.literal("ok"),
});
export const HostedSessionResponseSchema = z.strictObject({
  user: HostedSessionUserSchema.nullable(),
});
export const HostedProjectsResponseSchema = z.strictObject({
  projects: z.array(HostedProjectSummarySchema).max(100_000),
});
export const HostedProjectResponseSchema = z.strictObject({
  project: HostedProjectSchema,
});
export const HostedProjectCreatedResponseSchema = z.strictObject({
  project: HostedProjectSummarySchema,
});
export const HostedProjectMembersResponseSchema = z.strictObject({
  users: z.array(HostedProjectAccessUserSchema).max(100_000),
});
export const HostedResourceMountsResponseSchema = z.strictObject({
  mounts: z.array(HostedResourceMountSchema).max(10_000),
});
export const HostedResourceMountedResponseSchema = z.strictObject({
  mount: HostedResourceMountSchema,
});
export const HostedAssetSearchResponseSchema = z.strictObject({
  assets: z.array(HostedAssetSchema).max(10_000),
  nextCursor: z.string().max(4_096).nullable(),
});
export const HostedCreatedMapSchema = HostedProjectMapSchema.extend(
  HostedMapSnapshotSchema.shape,
);
export const HostedMapCreatedResponseSchema = z.strictObject({
  map: HostedCreatedMapSchema,
});
export const HostedMapResponseSchema = z.strictObject({
  map: HostedMapLaunchSchema,
});
export const HostedRealtimeTicketResponseSchema = z.strictObject({
  ticket: z.string().min(1).max(4_096),
  expiresAt: timestamp,
  actorId: id,
  displayName: name,
});
export const HostedBuildsResponseSchema = z.strictObject({
  builds: z.array(HostedBuildSchema).max(10_000),
  capability: z
    .strictObject({
      profileId: id,
      durationHint: z.string().min(1).max(256).optional(),
    })
    .nullable(),
});
export const HostedBuildCreatedResponseSchema = z.strictObject({
  build: HostedBuildSchema,
});
export const HostedCheckpointResponseSchema = z.strictObject({
  checkpoint: HostedCheckpointSchema,
});
export const HostedCheckpointsResponseSchema = z.strictObject({
  checkpoints: z.array(HostedCheckpointSchema).max(10_000),
});
export const HostedCheckpointSourceResponseSchema = z.strictObject({
  checkpoint: HostedCheckpointSchema,
  source: z.string().max(8 * 1_024 * 1_024),
});
export type HostedCheckpointSource = z.infer<
  typeof HostedCheckpointSourceResponseSchema
>;

export const CreateHostedProjectRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  game: HostedGameSchema,
});
export const SetProjectMemberRoleRequestSchema = z.strictObject({
  role: z.enum(["editor", "viewer"]),
});
export const CreateHostedMapRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  format: HostedMapFormatSchema,
  source: z
    .string()
    .max(2 * 1_024 * 1_024)
    .optional(),
});
export const MountHostedAssetRequestSchema = z.strictObject({ assetId: id });

export const CreateHostedCheckpointRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});
export const ReplaceHostedMapSourceRequestSchema = z.strictObject({
  expectedMapVersion: z.number().int().nonnegative(),
  expectedSourceSha256: sha256,
  source: z
    .string()
    .min(1)
    .max(8 * 1_024 * 1_024),
});
export const ReplaceHostedMapSourceResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("replaced"),
      map: HostedMapSnapshotSchema,
    }),
    z.strictObject({
      status: z.literal("conflict"),
      mapVersion: z.number().int().nonnegative(),
      sourceSha256: sha256,
    }),
  ],
);
export type ReplaceHostedMapSourceResult = z.infer<
  typeof ReplaceHostedMapSourceResultSchema
>;
export const CreateHostedBuildRequestSchema = z.strictObject({
  quality: z.enum(["preview", "final"]).default("preview"),
  expectedMapVersion: z.number().int().nonnegative().optional(),
});

export const MapCellInitializeRequestSchema = z.strictObject({
  source: z.string().max(8 * 1_024 * 1_024),
});
export const MapCellCheckpointRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});
