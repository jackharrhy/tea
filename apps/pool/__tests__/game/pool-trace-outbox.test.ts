import { expect, test } from "bun:test";
import { GameClient } from "../../app/game/client";

test("a delayed reconnect upload does not cause the next incident to hit server throttling", () => {
  const client = Object.create(GameClient.prototype) as any;
  const sent: string[] = [];
  Object.assign(client, {
    session: {
      connected: false,
      send: (message: { id: string }) => {
        sent.push(message.id);
        return true;
      },
    },
    poolTrace: { take: () => null },
    traceUploading: false,
    lastTraceSent: -Infinity,
    pendingTrace: { message: { id: "first" }, expiresAt: 60000 },
  });
  client.flushPoolTrace(39000);
  expect(sent).toEqual([]);
  client.session.connected = true;
  client.flushPoolTrace(40000);
  expect(sent).toEqual(["first"]);
  client.pendingTrace = { message: { id: "second" }, expiresAt: 102000 };
  client.flushPoolTrace(42000);
  expect(sent).toEqual(["first"]);
  expect(client.pendingTrace.message.id).toBe("second");
  client.flushPoolTrace(71000);
  expect(sent).toEqual(["first", "second"]);
  expect(client.pendingTrace).toBeNull();
});
