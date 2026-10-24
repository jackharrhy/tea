import type { MapBuildCapabilities, MapLaunchResult } from "./compiler.js";
import {
  MapCompileDiagnosticSchema,
  MapCompileLogSchema,
} from "./runtime-schemas.js";
import { z } from "zod";
import { MapsGameProfileSchema } from "./game-profiles.js";

// Shared by the remote browser adapter, hosted build queue, and native helper.
export const RemoteCompileRequestSchema = z.strictObject({
  mapName: z.string().min(1).max(512),
  mapText: z.string(),
  quality: z.enum(["preview", "final"]),
  expectedDocumentRevision: z.number().int().nonnegative(),
  profileId: z.string().min(1).max(256).optional(),
  assets: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(4_096),
        mediaType: z.string().min(1).max(256),
        base64: z.string(),
      }),
    )
    .optional(),
});
export type RemoteCompileRequest = z.infer<typeof RemoteCompileRequestSchema>;

export const MapLaunchRequestSchema = z.strictObject({
  buildId: z.string().min(1).max(256),
  profileId: z.string().min(1).max(256),
  expectedDocumentRevision: z.number().int().nonnegative(),
});
export type RemoteLaunchRequest = z.infer<typeof MapLaunchRequestSchema>;

export const RemoteCompileArtifactSchema = z.strictObject({
  name: z.string().min(1).max(4_096),
  mediaType: z.string().min(1).max(256),
  base64: z.string(),
  kind: z.enum(["bsp", "package", "portal", "leak-path", "log", "other"]),
  stage: z.string().min(1).max(256).optional(),
});
export const RemoteCompileResultSchema = z.strictObject({
  status: z.enum(["succeeded", "failed"]),
  buildId: z.string().min(1).max(256),
  sourceDocumentRevision: z.number().int().nonnegative(),
  diagnostics: z.array(MapCompileDiagnosticSchema).max(10_000),
  artifacts: z.array(RemoteCompileArtifactSchema).max(1_000),
  elapsedMilliseconds: z.number().finite().nonnegative(),
  logs: z.array(MapCompileLogSchema).max(1_000),
});
export type RemoteCompileResult = z.infer<typeof RemoteCompileResultSchema>;
export const MapBuildCapabilitiesSchema = z.strictObject({
  protocolVersion: z.literal(1),
  compileProfiles: z.array(
    z.strictObject({
      id: z.string().min(1).max(256),
      label: z.string().min(1).max(256),
      game: MapsGameProfileSchema,
      qualities: z.array(z.enum(["preview", "final"])).max(2),
      durationHint: z.string().min(1).max(256).optional(),
    }),
  ),
  launchProfiles: z.array(
    z.strictObject({
      id: z.string().min(1).max(256),
      label: z.string().min(1).max(256),
      game: MapsGameProfileSchema,
    }),
  ),
}) satisfies z.ZodType<MapBuildCapabilities>;
export const MapLaunchResultSchema = z.strictObject({
  buildId: z.string().min(1).max(256),
  profileId: z.string().min(1).max(256),
  sourceDocumentRevision: z.number().int().nonnegative(),
  launchedAt: z.number().finite().nonnegative(),
}) satisfies z.ZodType<MapLaunchResult>;
