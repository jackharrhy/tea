import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION, type ServerMessage } from "@harrhy/pool-protocol";
import { preUpdate } from "../../server/pre-update";

async function wait(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error("WebSocket condition timed out");
    await Bun.sleep(10);
  }
}

test("public HTTP cannot drain; private drain preserves spectators and rejects new match admissions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "8ball-update-startup-"));
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../server/index.ts")],
    {
      env: {
        ...process.env,
        DATA_DIR: directory,
        API_PORT: "0",
        UPDATE_CONTROL_PORT: "0",
        HOST: "0.0.0.0",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const sockets: WebSocket[] = [];
  const startup = setTimeout(() => child.kill(), 8000);
  try {
    const reader = child.stdout.getReader();
    let logs = "";
    while (!logs.includes("update control listening")) {
      const result = await reader.read();
      if (result.done) throw new Error("server exited before control startup");
      logs += new TextDecoder().decode(result.value);
    }
    clearTimeout(startup);
    const api = Number(
      logs.match(/8ball server listening on 0\.0\.0\.0:(\d+)/)![1],
    );
    const control = Number(
      logs.match(/update control listening on 127\.0\.0\.1:(\d+)/)![1],
    );
    let snapshots = 0;
    const spectator = new WebSocket(`ws://127.0.0.1:${api}/ws?watch=1`);
    sockets.push(spectator);
    spectator.addEventListener("message", (e) => {
      if (JSON.parse(String(e.data)).type === "state") snapshots++;
    });
    await wait(() => snapshots > 0);
    for (const path of [
      "/drain",
      "/resume",
      "/api/drain",
      "/api/update/drain",
    ]) {
      const response = await fetch(`http://127.0.0.1:${api}${path}`, {
        method: "POST",
        headers: {
          "X-Forwarded-For": "127.0.0.1",
          Forwarded: "for=127.0.0.1",
          Host: `127.0.0.1:${control}`,
        },
      });
      expect(response.status).toBe(404);
    }
    expect(await preUpdate(control)).toBe(0);
    const before = snapshots;
    const messages: ServerMessage[] = [];
    const guest = new WebSocket(`ws://127.0.0.1:${api}/ws`);
    sockets.push(guest);
    guest.addEventListener("open", () =>
      guest.send(
        JSON.stringify({
          type: "hello",
          version: PROTOCOL_VERSION,
          name: "Gate transport test",
        }),
      ),
    );
    guest.addEventListener("message", (e) =>
      messages.push(JSON.parse(String(e.data))),
    );
    await wait(() => messages.some((m) => m.type === "welcome"));
    guest.send(JSON.stringify({ type: "join", table: "1" }));
    await wait(() => messages.some((m) => m.type === "error"));
    expect(messages.find((m) => m.type === "error")).toMatchObject({
      text: "The hall is preparing an update. Try again shortly.",
    });
    await wait(() => snapshots > before + 2);
    expect(spectator.readyState).toBe(WebSocket.OPEN);
    expect(await preUpdate(control, "resume")).toBe(0);
    guest.send(JSON.stringify({ type: "join", table: "1" }));
    await wait(() => messages.some((m) => m.type === "approach"));
  } finally {
    clearTimeout(startup);
    for (const socket of sockets) socket.close();
    child.kill("SIGTERM");
    await child.exited;
    rmSync(directory, { recursive: true, force: true });
  }
});
