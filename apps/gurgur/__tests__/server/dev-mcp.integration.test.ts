import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RuntimeId, Vec3 } from "@tea/gurgur-engine";
import { createGurgurServer } from "../../server/src/server";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

describe("dev MCP control plane", () => {
  test("is opt-in, loopback-only, and controls ephemeral host actors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gurgur-dev-mcp-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const disabled = await createGurgurServer({
      port: 0,
      hostname: "127.0.0.1",
      databasePath: join(directory, "disabled.sqlite"),
    });
    cleanup.push(() => disabled.stop());
    expect(disabled.devMcpUrl).toBeNull();
    disabled.stop();
    cleanup.pop();

    const server = await createGurgurServer({
      port: 0,
      hostname: "127.0.0.1",
      databasePath: join(directory, "enabled.sqlite"),
      devMcpPort: 0,
    });
    cleanup.push(() => server.stop());
    expect(server.devMcpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const healthUrl = new URL("/healthz", server.devMcpUrl!);
    expect(await (await fetch(healthUrl)).json()).toMatchObject({
      status: "ok",
      transport: "streamable-http",
      endpoint: "/mcp",
    });
    expect(
      (
        await fetch(healthUrl, {
          headers: { origin: "https://example.invalid" },
        })
      ).status,
    ).toBe(403);

    const client = new Client({
      name: "gurgur-dev-mcp-test",
      version: "1.0.0",
    });
    cleanup.push(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.devMcpUrl!)),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "get_world_state",
        "list_players",
        "list_props",
        "list_prop_archetypes",
        "raycast",
        "spawn_prop",
        "remove_spawned_prop",
        "spawn_player",
        "set_player_intent",
        "stop_player",
        "remove_player",
      ]),
    );

    const world = structured<{
      worldEpoch: number;
      serverTick: number;
      mcpPlayerCount: number;
    }>(await client.callTool({ name: "get_world_state", arguments: {} }));
    expect(world.worldEpoch).toBe(1);
    expect(world.serverTick).toBeGreaterThanOrEqual(0);
    expect(world.mcpPlayerCount).toBe(0);

    const spawnedPlayer = structured<{
      controllerId: string;
      player: { id: RuntimeId; position: Vec3 };
    }>(
      await client.callTool({
        name: "spawn_player",
        arguments: { position: { x: 0, y: 3, z: 0 }, yaw: 0 },
      }),
    );
    expect(spawnedPlayer.controllerId).toBeString();
    const before = spawnedPlayer.player.position;
    await client.callTool({
      name: "set_player_intent",
      arguments: {
        controllerId: spawnedPlayer.controllerId,
        moveZ: 1,
        durationSeconds: 0.15,
      },
    });
    await Bun.sleep(350);
    const players = structured<{
      players: Array<{
        id: RuntimeId;
        position: Vec3;
        control: string;
        intent: { moveX: number; moveZ: number };
      }>;
    }>(await client.callTool({ name: "list_players", arguments: {} }));
    const moved = players.players.find((player) =>
      sameId(player.id, spawnedPlayer.player.id),
    )!;
    expect(moved.control).toBe("mcp");
    expect(
      Math.hypot(moved.position.x - before.x, moved.position.z - before.z),
    ).toBeGreaterThan(0.05);
    expect(moved.intent.moveZ).toBe(0);

    const archetypes = structured<{
      archetypes: Array<{ entityIndex: number }>;
    }>(await client.callTool({ name: "list_prop_archetypes", arguments: {} }));
    expect(archetypes.archetypes.length).toBeGreaterThan(0);
    const spawnedProp = structured<{
      prop: { id: RuntimeId; ephemeral: boolean };
    }>(
      await client.callTool({
        name: "spawn_prop",
        arguments: {
          entityIndex: archetypes.archetypes[0]!.entityIndex,
          position: { x: before.x, y: before.y + 3, z: before.z },
        },
      }),
    );
    expect(spawnedProp.prop.ephemeral).toBeTrue();
    expect(
      structured<{ removed: boolean }>(
        await client.callTool({
          name: "remove_spawned_prop",
          arguments: { id: spawnedProp.prop.id },
        }),
      ).removed,
    ).toBeTrue();
    expect(
      structured<{ removed: boolean }>(
        await client.callTool({
          name: "remove_player",
          arguments: { controllerId: spawnedPlayer.controllerId },
        }),
      ).removed,
    ).toBeTrue();

    await client.callTool({
      name: "spawn_player",
      arguments: { position: { x: 1, y: 3, z: 1 } },
    });
    await client.callTool({
      name: "spawn_prop",
      arguments: { position: { x: 1, y: 5, z: 1 } },
    });
    await client.close();
    cleanup.pop();
    server.stop();
    cleanup.pop();

    const restarted = await createGurgurServer({
      port: 0,
      hostname: "127.0.0.1",
      databasePath: join(directory, "enabled.sqlite"),
      devMcpPort: 0,
    });
    cleanup.push(() => restarted.stop());
    const restartedClient = new Client({
      name: "gurgur-dev-mcp-restart-test",
      version: "1.0.0",
    });
    cleanup.push(() => restartedClient.close());
    await restartedClient.connect(
      new StreamableHTTPClientTransport(new URL(restarted.devMcpUrl!)),
    );
    const restoredWorld = structured<{
      mcpPlayerCount: number;
      ephemeralPropCount: number;
    }>(
      await restartedClient.callTool({
        name: "get_world_state",
        arguments: {},
      }),
    );
    expect(restoredWorld.mcpPlayerCount).toBe(0);
    expect(restoredWorld.ephemeralPropCount).toBe(0);
  });
});

function structured<T>(result: unknown): T {
  const content = (result as { structuredContent?: unknown }).structuredContent;
  expect(content).toBeDefined();
  return content as T;
}

function sameId(left: RuntimeId, right: RuntimeId): boolean {
  return left.index === right.index && left.generation === right.generation;
}
