import { chromium } from "playwright";

const origin = process.env.GARDEN_PERF_URL || "http://127.0.0.1:4322";
const samples = [];
for (let index = 0; index < 21; index++) {
  const start = performance.now();
  const response = await fetch(origin + "/", {
    headers: { "Accept-Encoding": "gzip" },
  });
  const ttfb = performance.now() - start;
  const html = await response.text();
  if (!response.ok) throw new Error(`Homepage: ${response.status}`);
  samples.push({
    ttfb,
    total: performance.now() - start,
    htmlBytes: Buffer.byteLength(html),
  });
}
const browser = await chromium.launch({ channel: "chrome" });
const loads = [];
try {
  for (let index = 0; index < 3; index++) {
    const context = await browser.newContext();
    await context.route("**/gc.zgo.at/**", (route) => route.abort());
    const page = await context.newPage();
    await page.addInitScript(() => {
      let lcp = 0;
      new PerformanceObserver((list) => {
        lcp = list.getEntries().at(-1)?.startTime || lcp;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      Object.defineProperty(window, "measuredLCP", { get: () => lcp });
    });
    await page.goto(origin, { waitUntil: "networkidle" });
    loads.push(
      await page.evaluate(() => {
        const navigation = performance.getEntriesByType(
          "navigation",
        )[0] as PerformanceNavigationTiming;
        const resources = performance.getEntriesByType(
          "resource",
        ) as PerformanceResourceTiming[];
        return {
          ttfb: navigation.responseStart - navigation.requestStart,
          fcp: performance.getEntriesByName("first-contentful-paint")[0]
            ?.startTime,
          lcp: (window as unknown as { measuredLCP: number }).measuredLCP,
          documentTransferred: navigation.transferSize,
          resourcesTransferred: resources.reduce(
            (sum, resource) => sum + resource.transferSize,
            0,
          ),
          requests: resources.length + 1,
        };
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
const warm = samples
  .slice(1)
  .map((sample) => sample.ttfb)
  .toSorted((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      origin,
      firstRequest: samples[0],
      warmTTFB: {
        median: warm[10],
        p95: warm[18],
        min: warm[0],
        max: warm[19],
      },
      browserColdLoads: loads,
    },
    null,
    2,
  ),
);
