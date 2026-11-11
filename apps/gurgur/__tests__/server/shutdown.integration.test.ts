import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("production entrypoint rejects invalid environment before binding a port", async () => {
  const cases = [
    {
      PORT: "0",
      expected: "PORT must be",
    },
    {
      PORT: "3000",
      PUBLIC_ORIGIN: "not a URL",
      expected: "ERR_INVALID_URL",
    },
    {
      PORT: "3000",
      EXTRA_DYNAMIC_BODIES: "513",
      expected: "EXTRA_DYNAMIC_BODIES",
    },
    {
      PORT: "3000",
      PLAYER_SPAWN: "0,nope,1",
      expected: "PLAYER_SPAWN",
    },
    {
      PORT: "3000",
      RTC_PORT_MIN: "40100",
      RTC_PORT_MAX: "40000",
      expected: "RTC_PORT_MIN",
    },
    {
      PORT: "3000",
      RTC_ICE_SERVERS_JSON: '[{"urls":"https://not-ice.example"}]',
      expected: "RTC_ICE_SERVERS_JSON",
    },
  ];
  for (const fixture of cases) {
    const child = Bun.spawn([process.execPath, "server/src/index.ts"], {
      cwd: new URL("../..", import.meta.url).pathname,
      env: {
        ...globalThis.process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        DATABASE_PATH: ":memory:",
        ...fixture,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain(fixture.expected);
  }
});

test("SIGTERM closes the one-process server within the grace period", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gurgur-shutdown-"));
  const reservation = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(),
  });
  const port = reservation.port!;
  reservation.stop(true);
  const process = Bun.spawn(["bun", "server/src/index.ts"], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: {
      ...globalThis.process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_PATH: join(directory, "world.sqlite"),
      PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const deadline = performance.now() + 5_000;
    while (performance.now() < deadline) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/readyz`)).ok) break;
      } catch {
        /* process is still starting */
      }
      await Bun.sleep(20);
    }
    expect((await fetch(`http://127.0.0.1:${port}/readyz`)).ok).toBe(true);
    const stoppedAt = performance.now();
    process.kill("SIGTERM");
    const exitCode = await Promise.race([
      process.exited,
      Bun.sleep(3_000).then(() => -999),
    ]);
    expect(exitCode).toBe(0);
    expect(performance.now() - stoppedAt).toBeLessThan(3_000);
    expect(await Bun.file(join(directory, "world.sqlite")).exists()).toBe(true);
  } finally {
    process.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});
