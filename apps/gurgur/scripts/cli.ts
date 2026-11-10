import { watch } from "node:fs";

const [command, subcommand, ...args] = process.argv.slice(2);

async function run(
  argv: string[],
  options: { env?: Record<string, string>; allowFailure?: boolean } = {},
): Promise<number> {
  const child = Bun.spawn(argv, {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0 && !options.allowFailure)
    throw new Error(`${argv.join(" ")} exited with code ${exitCode}`);
  return exitCode;
}

async function content(action = "compile"): Promise<void> {
  if (action === "compile") {
    await import("../tools/generate-fgd/src/index");
    await import("../tools/compile-map/src/index");
    return;
  }
  if (action === "setup") {
    await content("compile");
    await run(["bun", "scripts/setup-trenchbroom.ts"]);
    return;
  }
  if (action === "render-player") {
    await run(["bun", "tools/render-player-billboard/src/index.ts"]);
    return;
  }
  if (action === "setup-player-harness") {
    await run([
      "bun",
      "tools/render-player-billboard/src/index.ts",
      "--setup-only",
      "--save-harness",
    ]);
    return;
  }
  throw new Error(
    "content requires compile, setup, render-player, or setup-player-harness",
  );
}

async function testBrowser(action = "all"): Promise<void> {
  if (
    ![
      "all",
      "movement",
      "pickup",
      "contention",
      "contraption",
      "capture",
    ].includes(action)
  )
    throw new Error(
      "test:browser requires all, movement, pickup, contention, contraption, or capture",
    );
  await run(["bun", "scripts/smoke-browser.ts"], {
    env: { SMOKE_SCENARIO: action },
  });
}

async function testNetwork(action = "matrix"): Promise<void> {
  const quick = action === "--quick" || args.includes("--quick");
  if (action === "--quick") action = "matrix";
  if (!["single", "matrix", "stress"].includes(action))
    throw new Error("test:network requires single, matrix, or stress");
  const script =
    action === "matrix"
      ? "tools/network-harness/src/matrix.ts"
      : "tools/network-harness/src/run.ts";
  await run(["bun", script], {
    env: {
      ...(action === "stress"
        ? {
            HARNESS_CLIENTS: "32",
            HARNESS_PROPS: "256",
            HARNESS_NONBLOCKING: "1",
          }
        : {}),
      ...(quick ? { HARNESS_QUICK: "1" } : {}),
    },
  });
}

async function soak(action: string | undefined): Promise<void> {
  const file = {
    physics: "tools/physics-soak.ts",
    connections: "tools/connection-soak.ts",
    persistence: "tools/persistence-soak.ts",
  }[action ?? ""];
  if (!file)
    throw new Error("soak requires physics, connections, or persistence");
  await run(["bun", file]);
}

async function dev(): Promise<void> {
  await content("compile");
  let server: ReturnType<typeof Bun.spawn> | null = null;
  let rebuilding = false;
  let queued = false;
  let debounce: Timer | null = null;
  const startServer = (): void => {
    server = Bun.spawn(["bun", "server/src/index.ts"], {
      cwd: process.cwd(),
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  };
  const rebuild = async (): Promise<void> => {
    if (rebuilding) {
      queued = true;
      return;
    }
    rebuilding = true;
    try {
      await content("compile");
      server?.kill();
      if (server) await server.exited;
      startServer();
    } catch (error) {
      console.error(error);
    } finally {
      rebuilding = false;
      if (queued) {
        queued = false;
        void rebuild();
      }
    }
  };
  startServer();
  const watchers = [
    watch("content/maps", { recursive: true }, () => schedule()),
    watch("content/sprites", { recursive: true }, () => schedule()),
    watch("content/textures", { recursive: true }, () => schedule()),
    watch("packages/game/src", { recursive: true }, () => schedule()),
  ];
  function schedule(): void {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void rebuild(), 150);
  }
  let finish!: () => void;
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stop = (): void => {
    watchers.forEach((watcher) => watcher.close());
    server?.kill();
    finish();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await stopped;
}

if (command === "content") await content(subcommand);
else if (command === "test-browser") await testBrowser(subcommand);
else if (command === "test-network") await testNetwork(subcommand);
else if (command === "soak") await soak(subcommand);
else if (command === "dev") await dev();
else throw new Error("unknown repository command");
