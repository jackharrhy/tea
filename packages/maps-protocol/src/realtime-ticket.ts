import { z } from "zod";

export const ProjectRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;

export const RealtimeTicketPayloadSchema = z.strictObject({
  version: z.literal(2),
  mapId: z.string().min(1).max(256),
  principalId: z.string().min(1).max(256),
  actorId: z.string().min(1).max(256),
  role: ProjectRoleSchema,
  expiresAt: z.number().int().positive(),
});

export type RealtimeTicketPayload = z.infer<typeof RealtimeTicketPayloadSchema>;

export function parseActiveRealtimeTicketPayload(
  value: unknown,
  now = Date.now(),
): RealtimeTicketPayload | null {
  const result = RealtimeTicketPayloadSchema.safeParse(value);
  return result.success && result.data.expiresAt > now ? result.data : null;
}
