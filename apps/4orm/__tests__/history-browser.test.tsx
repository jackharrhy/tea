import { test, expect } from "vitest";
import { renderToString } from "remix/component/server";
import { css } from "remix/component";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Document } from "../app/views.tsx";

test("shell canvas is server rendered and enhancement scripts cannot block its parsing", async () => {
  const html = await renderToString(
    <Document title="fixture" member={null}>
      <h1>fixture</h1>
    </Document>,
  );
  expect(html).toContain("data-rmx-style");
  expect(html).toMatch(/background-color:\s*#f0f0f0/);
  expect(html).toMatch(/<script(?=[^>]*defer)(?=[^>]*htmx\.min\.js)[^>]*>/);
  expect(html).toMatch(/<script(?=[^>]*defer)(?=[^>]*app\.js)[^>]*>/);
});

test.skipIf(process.env.FOURM_HISTORY_BROWSER !== "1")(
  "document history keeps the shell canvas and browser-owned form/scroll state",
  async () => {
    const pages = new Map<string, string>();
    for (const tab of ["forum", "chat"]) {
      pages.set(
        `/${tab}`,
        "<!doctype html>" +
          (await renderToString(
            <Document title={tab} member={null}>
              <h1>{tab}</h1>
              <label>
                Draft <input name="draft" />
              </label>
              <div mix={css({ height: "2000px" })} />
            </Document>,
          )),
      );
    }
    const stylesheet = await readFile(
      new URL("../static/style.css", import.meta.url),
      "utf8",
    );
    const server = createServer((req, res) => {
      if (req.url === "/static/style.css") {
        // Deliberately slow the shared stylesheet on EVERY history traversal.
        setTimeout(() => {
          res.writeHead(200, {
            "Content-Type": "text/css",
            "Cache-Control": "no-store",
          });
          res.end(stylesheet);
        }, 150);
      } else if (pages.has(req.url!)) {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Cache-Control": "no-store",
        });
        res.end(pages.get(req.url!));
      } else {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end("");
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const browser = await chromium.launch();
    try {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      for (const width of [390, 1280]) {
        const context = await browser.newContext({
          viewport: { width, height: 720 },
          serviceWorkers: "block",
        });
        const page = await context.newPage();
        const canvas = () =>
          page.evaluate(
            () => getComputedStyle(document.documentElement).backgroundColor,
          );
        await page.goto(origin + "/forum");
        expect(await canvas()).toBe("rgb(240, 240, 240)");
        // The critical canvas must survive without the external stylesheet at all.
        await page.evaluate(() => {
          document.querySelector<HTMLLinkElement>(
            'link[rel="stylesheet"]',
          )!.disabled = true;
        });
        expect(await canvas()).toBe("rgb(240, 240, 240)");
        await page.evaluate(() => {
          document.querySelector<HTMLLinkElement>(
            'link[rel="stylesheet"]',
          )!.disabled = false;
        });
        await expect
          .poll(() =>
            page.evaluate(() => getComputedStyle(document.body).fontFamily),
          )
          .toContain("Verdana");
        await page
          .getByRole("textbox", { name: "Draft" })
          .fill("unsent forum draft");
        await page.evaluate(() => scrollTo(0, 320));
        await page.evaluate(() =>
          (
            document.querySelector('nav a[href="/chat"]') as HTMLElement
          ).click(),
        );
        await page.waitForURL(origin + "/chat");
        await page.waitForLoadState();
        expect(await canvas()).toBe("rgb(240, 240, 240)");
        await page
          .getByRole("textbox", { name: "Draft" })
          .fill("unsent chat draft");
        await page.goBack();
        expect(new URL(page.url()).pathname).toBe("/forum");
        expect(await canvas()).toBe("rgb(240, 240, 240)");
        expect(
          await page.getByRole("textbox", { name: "Draft" }).inputValue(),
        ).toBe("unsent forum draft");
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(320);
        await page.goForward();
        expect(new URL(page.url()).pathname).toBe("/chat");
        expect(await canvas()).toBe("rgb(240, 240, 240)");
        expect(
          await page.getByRole("textbox", { name: "Draft" }).inputValue(),
        ).toBe("unsent chat draft");
        await context.close();
      }
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  30000,
);
