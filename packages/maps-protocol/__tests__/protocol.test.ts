import { createStarterDocument, serializeMap } from "@tea/maps-editor/core";
import { describe, expect, it } from "vitest";

import {
  HostedProjectCreatedResponseSchema,
  isGameTreeAssetPath,
  parseActiveRealtimeTicketPayload,
  parseCollaborationClientFrame,
  parseCollaborationServerFrame,
} from "../src/index.js";

describe("Worldview wire protocols", () => {
  it("accepts contained Quake II build assets and rejects escaped paths", () => {
    expect(isGameTreeAssetPath("textures/e1u1/metal.wal")).toBe(true);
    expect(isGameTreeAssetPath("textures/e1u1/metal.png")).toBe(true);
    expect(isGameTreeAssetPath("pics/colormap.pcx")).toBe(true);
    expect(isGameTreeAssetPath("textures/../secret.wal")).toBe(false);
    expect(isGameTreeAssetPath("pics/other.pcx")).toBe(false);
  });

  it("accepts bounded presence and rejects unknown and oversized client fields", () => {
    expect(
      parseCollaborationClientFrame(
        JSON.stringify({
          type: "presence",
          presence: {
            actorId: "alice",
            viewport: "xy",
            pointer: [1, 2, 3],
            sentAt: 1,
            preview: {
              interactionId: "drag-1",
              sequence: 4,
              baseMapVersion: 2,
              edits: [
                { kind: "delete-brush", brushId: "brush", baseRevision: 0 },
              ],
            },
          },
        }),
      ),
    ).toMatchObject({ type: "presence" });
    expect(() =>
      parseCollaborationClientFrame(
        JSON.stringify({
          type: "presence",
          presence: { actorId: "alice", sentAt: 1, unexpected: true },
        }),
      ),
    ).toThrow(/Invalid collaboration frame/);
    expect(() =>
      parseCollaborationClientFrame(
        JSON.stringify({
          type: "presence",
          presence: { actorId: "alice", pointer: [0, "bad", 0], sentAt: 1 },
        }),
      ),
    ).toThrow(/Invalid collaboration frame/);
    expect(() =>
      parseCollaborationClientFrame(
        JSON.stringify({
          type: "operation",
          operation: {
            schemaVersion: 1,
            operationId: "bad",
            transactionId: "bad",
            actorId: "mallory",
            baseMapVersion: 0,
            label: "Malformed",
            edits: [
              { kind: "replace-brush", brushId: "brush", baseRevision: 0 },
            ],
          },
        }),
      ),
    ).toThrow(/Invalid collaboration frame/);
    expect(() =>
      parseCollaborationClientFrame("x".repeat(512 * 1_024 + 1)),
    ).toThrow(/too large/);
  });

  it("validates the complete canonical room snapshot sent to browsers", () => {
    const document = createStarterDocument();
    expect(
      parseCollaborationServerFrame(
        JSON.stringify({
          type: "ready",
          mapId: "map-1",
          mapVersion: 0,
          document,
          source: serializeMap(document),
          sourceSha256: "a".repeat(64),
        }),
      ),
    ).toMatchObject({ type: "ready", mapId: "map-1" });
    expect(() =>
      parseCollaborationServerFrame(
        JSON.stringify({ type: "ready", document }),
      ),
    ).toThrow(/Invalid collaboration frame/);
  });

  it("keeps hosted responses strict and ticket expiry semantic", () => {
    const project = {
      id: "project-1",
      slug: "project",
      name: "Project",
      game: "quake",
      role: "owner",
      updatedAt: 1,
    };
    expect(
      HostedProjectCreatedResponseSchema.safeParse({ project }).success,
    ).toBe(true);
    expect(
      HostedProjectCreatedResponseSchema.safeParse({
        project: { ...project, legacy: true },
      }).success,
    ).toBe(false);

    const ticket = {
      version: 2,
      mapId: "map-1",
      principalId: "user-1",
      actorId: "user-1",
      role: "editor",
      expiresAt: 100,
    } as const;
    expect(parseActiveRealtimeTicketPayload(ticket, 99)).toEqual(ticket);
    expect(parseActiveRealtimeTicketPayload(ticket, 100)).toBeNull();
  });
});
