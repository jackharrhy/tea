import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import sharp from "sharp";
import { createContentStore } from "../app/content/store.ts";

const before = process.env.GARDEN_BEFORE_URL || "http://127.0.0.1:4321";
const after = process.env.GARDEN_AFTER_URL || "http://127.0.0.1:4322";
const output = path.resolve("tmp/parity");
await fs.mkdir(output, { recursive: true });
const entries = createContentStore(
  process.env.GARDEN_VAULT_PATH || "./vault/Garden",
).read().entries;
const special = entries
  .filter((entry) => entry.data.custom_layout || entry.data["custom-layout"])
  .map((entry) => `/${entry.id}`);
const paths = [
  "/",
  "/about",
  "/projects",
  "/now",
  "/linkblog",
  "/devblog",
  "/tools/youtube-thumbnail-fetcher",
  ...special,
  "/" + entries.find((entry) => /^linkblog\/\d/.test(entry.id))!.id,
];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    await context.route("**/tools/lastfm/now-playing*", (route) =>
      route.fulfill({ status: 204 }),
    );
    await context.route("**/gc.zgo.at/**", (route) => route.abort());
    // Animated media is compared at its first frame, not at two arbitrary playback times.
    await context.route("**/*.gif*", async (route) => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      const body = await sharp(await response.body(), { animated: false })
        .png()
        .toBuffer();
      return route.fulfill({ response, body, contentType: "image/png" });
    });
    for (const pathname of paths) {
      const images: Buffer[] = [];
      const texts: string[] = [];
      const dimensions = [];
      for (const [label, origin] of [
        ["before", before],
        ["after", after],
      ]) {
        const page = await context.newPage();
        const response = await page.goto(origin + pathname, {
          waitUntil: "networkidle",
        });
        assert.equal(response?.status(), 200, `${label}: ${pathname}`);
        await page.addStyleTag({
          content:
            "astro-dev-toolbar{display:none!important} canvas,iframe{visibility:hidden!important}",
        });
        await page.evaluate(async () => {
          for (const image of document.images) image.loading = "eager";
          await Promise.all(
            [...document.images].map((image) => image.decode().catch(() => {})),
          );
          await document.fonts.ready;
        });
        texts.push(await page.locator("main").innerText());
        dimensions.push(
          await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
          })),
        );
        const image = await page.screenshot({ fullPage: true });
        images.push(image);
        const name = `${width}-${pathname.replaceAll("/", "_") || "home"}-${label}.png`;
        await fs.writeFile(path.join(output, name), image);
        await page.close();
      }
      const one = await sharp(images[0])
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const two = await sharp(images[1])
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let different = 0;
      if (
        one.info.width === two.info.width &&
        one.info.height === two.info.height
      ) {
        for (let pixel = 0; pixel < one.data.length; pixel += 4) {
          if (
            [0, 1, 2].some(
              (channel) =>
                Math.abs(
                  one.data[pixel + channel] - two.data[pixel + channel],
                ) > 10,
            )
          )
            different++;
        }
      } else different = one.info.width * one.info.height;
      results.push({
        width,
        pathname,
        textEqual: texts[0] === texts[1],
        dimensions,
        differentPixels: different,
        percent: (different / (one.info.width * one.info.height)) * 100,
      });
      console.log(JSON.stringify(results.at(-1)));
    }
    await context.close();
  }
} finally {
  await browser.close();
}
await fs.writeFile(
  path.join(output, "report.json"),
  JSON.stringify(results, null, 2),
);
assert.ok(
  results.every((result) => result.textEqual && result.percent < 0.1),
  "Visual parity failed; inspect tmp/parity/report.json and screenshots",
);
