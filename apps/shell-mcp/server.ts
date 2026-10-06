import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createRequestListener } from "remix/node-fetch-server";
import { createLogger } from "@tea/logger";
import { createApp } from "./app/router.ts";
import { readConfig, type AppConfig } from "./app/config.ts";
import { createRuntime } from "./app/runtime.ts";

export async function startServer(config = readConfig()) {
  const { identity, jobs } = await createRuntime(config);
  const logger = createLogger({
    service: "shell-mcp",
    environment: process.env.NODE_ENV,
  });
  let app: ReturnType<typeof createApp> | undefined;
  const server = createServer(
    { maxHeaderSize: 8192 },
    createRequestListener(
      (request) =>
        logger.request(
          request,
          () => app?.fetch(request) ?? new Response(null, { status: 503 }),
        ),
      {
        trustProxy: false,
        protocol: new URL(config.publicOrigin).protocol,
        onError: () => new Response(null, { status: 503 }),
      },
    ),
  );
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port =
    address && typeof address !== "string" ? address.port : config.port;
  const boundOrigin = `http://${config.host === "::1" ? "[::1]" : config.host}:${port}`;
  const activeConfig: AppConfig =
    config.port === 0 && new URL(config.publicOrigin).port === "0"
      ? {
          ...config,
          publicOrigin: boundOrigin,
          resource: `${boundOrigin}/mcp`,
        }
      : config;
  app = createApp(activeConfig, identity, jobs);
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await jobs.closeAndWait();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
    })());
  return { server, app, jobs, origin: boundOrigin, close };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const running = await startServer();
    console.log(
      `Shell MCP at ${running.origin}; see protected configuration for execution mode`,
    );
    const shutdown = () => {
      const deadline = setTimeout(() => process.exit(1), 10_000).unref();
      void running.close().then(
        () => clearTimeout(deadline),
        () => {
          process.exitCode = 1;
        },
      );
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch {
    console.error(
      "Startup refused: check non-secret configuration, verified owner pin, and credential file permissions",
    );
    process.exitCode = 1;
  }
}
