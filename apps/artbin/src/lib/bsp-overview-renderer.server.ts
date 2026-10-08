import { chromium } from "playwright";
import type { BspFormat } from "@jackharrhy/worldview/core";

import { bspOverviewEntryHref } from "../../app/assets.ts";

export interface BspOverviewSources {
  format: BspFormat;
  bspPath: string;
  palettePath?: string;
  wadPaths: readonly string[];
  gameAssetPaths: Readonly<Record<string, string>>;
  skyboxPaths: Readonly<Record<string, string>>;
  spritePaths: Readonly<Record<string, string>>;
  soundPaths: Readonly<Record<string, string>>;
}

export interface RenderBspOverviewOptions {
  appOrigin: string;
  sources: BspOverviewSources;
  width?: number;
  height?: number;
  maxWalkabilityNodes?: number;
  timeoutMs?: number;
}

export interface GeneratedBspDerivatives {
  png: Buffer;
  walkabilityJson?: string;
  usedWalkability: boolean;
  warnings: string[];
}

const chromiumArguments = [
  "--enable-features=Vulkan",
  "--use-angle=swiftshader",
  "--use-vulkan=swiftshader",
  "--use-webgpu-adapter=swiftshader",
  "--disable-vulkan-surface",
  "--enable-unsafe-webgpu",
];
const renderAssetOrigin = "https://artbin-render.invalid";

export async function generateBspDerivatives(
  options: RenderBspOverviewOptions,
): Promise<GeneratedBspDerivatives> {
  const browser = await chromium.launch({
    args: chromiumArguments,
    channel: "chromium",
    ...(process.env.ARTBIN_CHROMIUM_PATH
      ? { executablePath: process.env.ARTBIN_CHROMIUM_PATH }
      : {}),
  });

  try {
    const page = await browser.newPage();
    await page.route(`${renderAssetOrigin}/**`, async (route) => {
      const url = new URL(route.request().url());
      let path: string | null = null;
      if (url.pathname === "/bsp") path = options.sources.bspPath;
      else if (url.pathname === "/palette")
        path = options.sources.palettePath ?? null;
      else if (url.pathname.startsWith("/wad/"))
        path =
          options.sources.wadPaths[
            Number(url.pathname.slice("/wad/".length))
          ] ?? null;
      else if (url.pathname.startsWith("/asset/"))
        path =
          options.sources.gameAssetPaths[
            decodeURIComponent(url.pathname.slice(7))
          ] ?? null;
      else if (url.pathname.startsWith("/skybox/"))
        path =
          options.sources.skyboxPaths[
            decodeURIComponent(url.pathname.slice(8))
          ] ?? null;
      else if (url.pathname.startsWith("/sprite/"))
        path =
          options.sources.spritePaths[
            decodeURIComponent(url.pathname.slice(8))
          ] ?? null;
      else if (url.pathname.startsWith("/sound/"))
        path =
          options.sources.soundPaths[
            decodeURIComponent(url.pathname.slice(7))
          ] ?? null;
      await route.fulfill(
        path
          ? { path, headers: { "access-control-allow-origin": "*" } }
          : {
              status: 404,
              body: "Not found",
              headers: { "access-control-allow-origin": "*" },
            },
      );
    });
    await page.goto(new URL("/login", options.appOrigin).href, {
      waitUntil: "domcontentloaded",
    });

    const entryHref = new URL(bspOverviewEntryHref, options.appOrigin).href;
    const result = await withTimeout(
      page.evaluate(
        async ({ entryHref: moduleHref, input }) => {
          const module = await import(moduleHref);
          return module.generateBspDerivatives(input);
        },
        {
          entryHref,
          input: {
            bspUrl: `${renderAssetOrigin}/bsp`,
            format: options.sources.format,
            ...(options.sources.palettePath
              ? { paletteUrl: `${renderAssetOrigin}/palette` }
              : {}),
            wadUrls: options.sources.wadPaths.map(
              (_, index) => `${renderAssetOrigin}/wad/${index}`,
            ),
            gameAssets: routeMap(options.sources.gameAssetPaths, "asset"),
            skybox: routeMap(options.sources.skyboxPaths, "skybox"),
            sprites: routeMap(options.sources.spritePaths, "sprite"),
            sounds: routeMap(options.sources.soundPaths, "sound"),
            width: options.width ?? 512,
            height: options.height ?? 512,
            maxWalkabilityNodes: options.maxWalkabilityNodes ?? 50_000,
          },
        },
      ),
      options.timeoutMs ?? 120_000,
    );

    return {
      png: Buffer.from(result.pngBase64, "base64"),
      ...(result.walkabilityJson
        ? { walkabilityJson: result.walkabilityJson }
        : {}),
      usedWalkability: result.usedWalkability,
      warnings: result.warnings,
    };
  } finally {
    await browser.close();
  }
}

function routeMap(
  paths: Readonly<Record<string, string>>,
  route: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(paths).map((name) => [
      name,
      `${renderAssetOrigin}/${route}/${encodeURIComponent(name)}`,
    ]),
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                `BSP overview rendering timed out after ${timeoutMs}ms`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
