import { createController, createRouter } from "remix/router";
import { readRequestBody } from "@tea/request-body";
import {
  compileNativeMap,
  parseCompilerGameProfile,
  type NativeCompilerConfig,
} from "./compiler.js";
import { configuredLaunchProfile, launchBuild } from "./launch.js";
import {
  BoundedBuildHistory,
  helperCapabilities,
  originAllowed,
  parseCompileRequest,
  parseLaunchRequest,
} from "./protocol.js";
import { routes } from "./routes.js";

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const result = await readRequestBody(request, { maxBytes });
  if (!result.ok) {
    throw new Error(
      result.error === "too_large"
        ? "Request body is too large"
        : "Invalid request body",
    );
  }
  return JSON.parse(new TextDecoder().decode(result.bytes));
}

export function createCompilerApp(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const maxRequestBytes = Number(
    environment.TEA_MAPS_COMPILER_MAX_REQUEST_BYTES ?? 96 * 1024 * 1024,
  );
  const maxConcurrent = Number(
    environment.TEA_MAPS_COMPILER_MAX_CONCURRENT ?? 2,
  );
  const maxMapBytes = Number(
    environment.TEA_MAPS_COMPILER_MAX_MAP_BYTES ?? 2 * 1024 * 1024,
  );
  const maxAssets = Number(environment.TEA_MAPS_COMPILER_MAX_ASSETS ?? 16);
  const maxAssetBase64Bytes = Number(
    environment.TEA_MAPS_COMPILER_MAX_ASSET_BASE64_BYTES ?? 32 * 1024 * 1024,
  );
  const allowedOrigins = new Set(
    (
      environment.TEA_MAPS_COMPILER_ORIGINS ??
      "http://127.0.0.1:8790,http://localhost:8790"
    )
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  const gameProfile = parseCompilerGameProfile(
    environment.TEA_MAPS_GAME_PROFILE,
  );
  const ericwTarget = {
    quake: "quake",
    goldsrc: "goldsrc",
    gower: "quake2",
  } as const;
  const config: NativeCompilerConfig = {
    toolchain:
      gameProfile === "quake2"
        ? { kind: "q2tool", executable: environment.TEA_MAPS_Q2TOOL ?? "" }
        : {
            kind: "ericw",
            target: ericwTarget[gameProfile],
            qbsp: environment.ERICW_QBSP ?? "",
            vis: environment.ERICW_VIS ?? "",
            light: environment.ERICW_LIGHT ?? "",
          },
    ...(environment.TEA_MAPS_GAME_DIR
      ? { gameDirectory: environment.TEA_MAPS_GAME_DIR }
      : {}),
    maxThreads: Math.max(1, Number(environment.TEA_MAPS_COMPILER_THREADS ?? 2)),
    timeoutMilliseconds: Math.max(
      1000,
      Number(environment.TEA_MAPS_COMPILER_TIMEOUT_MS ?? 5 * 60 * 1000),
    ),
    maxLogBytes: Math.max(
      1024,
      Number(environment.TEA_MAPS_COMPILER_MAX_LOG_BYTES ?? 512 * 1024),
    ),
    maxArtifactBytes: Math.max(
      1024,
      Number(
        environment.TEA_MAPS_COMPILER_MAX_ARTIFACT_BYTES ?? 64 * 1024 * 1024,
      ),
    ),
  };
  const launchProfile = configuredLaunchProfile(environment);
  const buildHistory = new BoundedBuildHistory(
    Math.max(1, Number(environment.TEA_MAPS_COMPILER_HISTORY ?? 20)),
  );
  let activeCompiles = 0;

  const compilerConfigured = () =>
    config.toolchain.kind === "q2tool"
      ? Boolean(config.toolchain.executable)
      : Boolean(
          config.toolchain.qbsp &&
          config.toolchain.vis &&
          config.toolchain.light,
        );
  const configurationError = () =>
    config.toolchain.kind === "q2tool"
      ? "TEA_MAPS_Q2TOOL must be configured for the quake2 profile"
      : "ERICW_QBSP, ERICW_VIS, and ERICW_LIGHT must be configured";

  const router = createRouter();
  router.map(
    routes,
    createController(routes, {
      actions: {
        health() {
          return Response.json(
            {
              status: compilerConfigured() ? "ready" : "unconfigured",
              activeCompiles,
            },
            { status: compilerConfigured() ? 200 : 503 },
          );
        },
        capabilities() {
          return Response.json(
            helperCapabilities(
              compilerConfigured(),
              gameProfile,
              launchProfile,
            ),
          );
        },
        async launch(context) {
          if (!launchProfile) {
            return Response.json(
              { error: "No external launch profile is configured" },
              { status: 503 },
            );
          }
          try {
            const requested = parseLaunchRequest(
              await readJson(context.request, maxRequestBytes),
            );
            if (requested.profileId !== launchProfile.profileId) {
              return Response.json(
                { error: "Unknown launch profile" },
                { status: 400 },
              );
            }
            const build = buildHistory.get(requested.buildId);
            if (!build) {
              return Response.json(
                { error: "Build is unavailable or expired" },
                { status: 404 },
              );
            }
            if (
              build.sourceDocumentRevision !==
              requested.expectedDocumentRevision
            ) {
              return Response.json(
                {
                  error: "Build revision does not match the requested revision",
                },
                { status: 409 },
              );
            }
            return Response.json(await launchBuild(build, launchProfile));
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : String(error) },
              { status: 400 },
            );
          }
        },
        async compile(context) {
          if (!compilerConfigured()) {
            return Response.json(
              { error: configurationError() },
              { status: 503 },
            );
          }
          if (activeCompiles >= maxConcurrent) {
            return Response.json(
              { error: "Compiler concurrency limit reached" },
              { status: 429 },
            );
          }
          activeCompiles += 1;
          try {
            const requested = parseCompileRequest(
              await readJson(context.request, maxRequestBytes),
              {
                maxMapBytes,
                maxAssets,
                maxAssetBase64Bytes,
              },
            );
            const result = await compileNativeMap(
              requested,
              config,
              context.request.signal,
            );
            buildHistory.remember(requested, result);
            return Response.json(result);
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : String(error) },
              { status: 400 },
            );
          } finally {
            activeCompiles -= 1;
          }
        },
      },
    }),
  );

  return {
    async fetch(request: Request): Promise<Response> {
      const origin = request.headers.get("origin") ?? undefined;
      if (!originAllowed(origin, allowedOrigins)) {
        return Response.json(
          { error: "Origin is not allowed" },
          { status: 403 },
        );
      }
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...(origin
              ? { "access-control-allow-origin": origin, vary: "origin" }
              : {}),
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type, authorization",
          },
        });
      }
      const response = await router.fetch(request);
      const headers = new Headers(response.headers);
      if (origin) {
        headers.set("access-control-allow-origin", origin);
        headers.set("vary", "origin");
      }
      if (response.status === 404) {
        return Response.json({ error: "Not found" }, { status: 404, headers });
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
    configured: compilerConfigured,
  };
}
