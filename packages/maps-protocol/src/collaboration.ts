import {
  CollaborationEditSchema,
  CollaborationFailureSchema,
  CollaborationOperationSchema,
  Vec3Schema,
  type CollaborationEdit,
  type CollaborationFailure,
} from "@tea/maps-editor/core";
import { z } from "zod";

import { WorldviewProtocolError, zodPath } from "./protocol-error.js";
import { HostedMapSnapshotSchema } from "./hosted.js";

export const MAX_CLIENT_FRAME_BYTES = 512 * 1_024;
export const MAX_SERVER_FRAME_BYTES = 16 * 1_024 * 1_024;

const CollaborationEditsSchema: z.ZodType<readonly CollaborationEdit[]> = z
  .array(CollaborationEditSchema)
  .max(256);
const CollaborationFailuresSchema: z.ZodType<readonly CollaborationFailure[]> =
  z.array(CollaborationFailureSchema).max(1_000);

export const CollaborationPresenceSchema = z.strictObject({
  actorId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(128).optional(),
  color: z.string().min(1).max(64).optional(),
  selectedObjectIds: z.array(z.string().min(1).max(256)).max(1_000).optional(),
  viewport: z.enum(["perspective", "xy", "xz", "yz"]).optional(),
  pointer: Vec3Schema.optional(),
  tool: z.string().min(1).max(128).optional(),
  preview: z
    .strictObject({
      interactionId: z.string().min(1).max(128),
      sequence: z.number().int().nonnegative(),
      baseMapVersion: z.number().int().nonnegative(),
      edits: CollaborationEditsSchema,
    })
    .optional(),
  sentAt: z.number().finite().nonnegative(),
});
export type CollaborationPresence = z.infer<typeof CollaborationPresenceSchema>;

export const CollaborationClientFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("operation"),
    operation: CollaborationOperationSchema,
  }),
  z.strictObject({
    type: z.literal("presence"),
    presence: CollaborationPresenceSchema,
  }),
]);
export type CollaborationClientFrame = z.infer<
  typeof CollaborationClientFrameSchema
>;

const mapVersion = z.number().int().nonnegative();
const sha256 = z.string().regex(/^[a-f\d]{64}$/i);
export const CollaborationServerFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("ready"),
    ...HostedMapSnapshotSchema.shape,
  }),
  z.strictObject({
    type: z.literal("operation"),
    mapVersion,
    sourceSha256: sha256,
    operation: CollaborationOperationSchema,
  }),
  z.strictObject({
    type: z.literal("ack"),
    operationId: z.string().min(1).max(128),
    mapVersion,
    sourceSha256: sha256,
  }),
  z.strictObject({
    type: z.literal("conflict"),
    operationId: z.string().min(1).max(128),
    conflicts: CollaborationFailuresSchema,
  }),
  z.strictObject({
    type: z.literal("presence"),
    presence: CollaborationPresenceSchema,
  }),
  z.strictObject({
    type: z.literal("error"),
    message: z.string().min(1).max(4_096),
  }),
]);
export type CollaborationServerFrame = z.infer<
  typeof CollaborationServerFrameSchema
>;

function parseFrame<T>(
  serialized: string,
  maximumBytes: number,
  schema: z.ZodType<T>,
): T {
  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    throw new WorldviewProtocolError(
      "payload-too-large",
      "Collaboration frame is too large",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new WorldviewProtocolError(
      "invalid-json",
      "Collaboration frame contains invalid JSON",
    );
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new WorldviewProtocolError(
      "invalid-payload",
      `Invalid collaboration frame: ${issue.message}`,
      zodPath(issue),
    );
  }
  return result.data;
}

export function parseCollaborationClientFrame(
  value: string | ArrayBuffer,
): CollaborationClientFrame {
  if (typeof value !== "string") {
    throw new WorldviewProtocolError(
      "binary-frame",
      "Binary collaboration frames are not supported",
    );
  }
  return parseFrame(
    value,
    MAX_CLIENT_FRAME_BYTES,
    CollaborationClientFrameSchema,
  );
}

export function parseCollaborationServerFrame(
  value: string,
): CollaborationServerFrame {
  return parseFrame(
    value,
    MAX_SERVER_FRAME_BYTES,
    CollaborationServerFrameSchema,
  );
}
