import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("server creates a WAL database and restarts without losing match records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "8ball-startup-"));
  try {
    for (let boot = 0; boot < 2; boot++) {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, "../../server/index.ts")],
        {
          cwd: directory,
          env: { ...process.env, API_PORT: "0" },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const timeout = setTimeout(() => child.kill(), 4000);
      try {
        const { value } = await child.stdout.getReader().read();
        const port = new TextDecoder()
          .decode(value)
          .match(/listening on 127\.0\.0\.1:(\d+)/)?.[1];
        if (!port)
          throw new Error(
            `Server failed to start: ${await new Response(child.stderr).text()}`,
          );
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        expect(response.ok).toBe(true);
        expect(await response.json()).toMatchObject({
          status: "ok",
          players: 0,
        });
        const db = new Database(join(directory, "data/8ball.sqlite"));
        try {
          expect(db.query("PRAGMA journal_mode").get()).toEqual({
            journal_mode: "wal",
          });
          expect(
            db.query("SELECT COUNT(*) AS count FROM matches").get(),
          ).toEqual({ count: boot });
          if (boot === 0)
            db.query(
              "INSERT INTO matches(table_id,winner,players,finished_at) VALUES(?,?,?,?)",
            ).run("1", "winner", '["winner","opponent"]', 1234);
          else
            expect(
              db
                .query(
                  "SELECT table_id,winner,players,finished_at FROM matches",
                )
                .get(),
            ).toEqual({
              table_id: "1",
              winner: "winner",
              players: '["winner","opponent"]',
              finished_at: 1234,
            });
        } finally {
          db.close();
        }
      } finally {
        clearTimeout(timeout);
        child.kill("SIGTERM");
        await child.exited;
      }
      expect(child.exitCode).toBe(0);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);

test("oversized websocket frames require joining and are throttled before parsing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "8ball-trace-socket-"));
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../server/index.ts")],
    {
      cwd: directory,
      env: { ...process.env, API_PORT: "0", DATA_DIR: directory },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const timeout = setTimeout(() => child.kill(), 5000);
  let socket: WebSocket | undefined;
  try {
    const { value } = await child.stdout.getReader().read();
    const port = new TextDecoder()
      .decode(value)
      .match(/listening on 127\.0\.0\.1:(\d+)/)?.[1];
    expect(port).toBeDefined();
    const { PROTOCOL_VERSION } = await import("@harrhy/pool-protocol");
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: { type: string; time?: number }[] = [];
    socket.addEventListener("message", (event) =>
      messages.push(JSON.parse(String(event.data))),
    );
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve(), { once: true });
      socket!.addEventListener("error", reject, { once: true });
    });
    const barrier = async (time: number) => {
      socket!.send(JSON.stringify({ type: "ping", time }));
      for (let i = 0; i < 100; i++) {
        if (messages.some((m) => m.type === "pong" && m.time === time)) return;
        await Bun.sleep(10);
      }
      throw new Error("Socket did not answer ping");
    };
    const hello = JSON.stringify({
      type: "hello",
      name: "Trace tester",
      version: PROTOCOL_VERSION,
    });
    socket.send(hello + " ".repeat(3000));
    socket.send(hello);
    await barrier(1);
    expect(messages.filter((m) => m.type === "welcome")).toHaveLength(1);
    expect(messages.filter((m) => m.type === "error")).toHaveLength(0);
    // First large frame reaches the parser, which still caps non-trace messages.
    socket.send(JSON.stringify({ type: "ping", time: 2 }) + " ".repeat(3000));
    // This malformed large frame must be discarded without a parse error response.
    socket.send("!".repeat(3000));
    await barrier(3);
    expect(messages.filter((m) => m.type === "error")).toHaveLength(1);
    expect(messages.some((m) => m.type === "pong" && m.time === 2)).toBe(false);
    // The large-frame throttle does not suppress ordinary message validation.
    socket.send("!");
    await barrier(4);
    expect(messages.filter((m) => m.type === "error")).toHaveLength(2);
  } finally {
    socket?.close();
    clearTimeout(timeout);
    child.kill("SIGTERM");
    await child.exited;
    rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);
