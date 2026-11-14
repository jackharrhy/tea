import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToString } from "remix/component/server";
import { jsx } from "remix/component/jsx-runtime";
import { HomePage, type HomePageProps } from "../app/actions/home-page.js";

const render = (props: Partial<HomePageProps> = {}) =>
  renderToString(
    jsx(HomePage, {
      csrf: "fixture-csrf",
      signedIn: true,
      items: [],
      ...props,
    }),
  );

test("the directory renders only supplied links and preserves their destinations", async () => {
  const destination = "https://fixture.invalid/music?source=directory";
  const html = await render({
    items: [{ id: "navidrome", name: "Navidrome", url: destination }],
  });
  assert.ok(html.includes(`href="${destination}"`));
  assert.ok(html.includes("- Listen to Music"));
  assert.ok(!html.includes("Management"));
  assert.ok(!html.includes('data-service="seerr"'));
  assert.equal((html.match(/<a\b[^>]*data-service=/g) ?? []).length, 1);
});

test("management-only access has a labelled group without fabricated primary links", async () => {
  const html = await render({
    items: [
      { id: "sonarr", name: "Sonarr", url: "https://fixture.invalid/tv" },
    ],
  });
  assert.ok(html.includes('aria-labelledby="management-title"'));
  assert.ok(html.includes('href="https://fixture.invalid/tv"'));
  assert.ok(!html.includes('aria-label="Services"'));
  assert.ok(!html.includes("No services assigned."));
});

test("anonymous and failed access states never expose supplied service links", async () => {
  const items = [
    { id: "sonarr", name: "Sonarr", url: "https://fixture.invalid/tv" },
  ];
  for (const state of [{ signedIn: false }, { unavailable: true }]) {
    const html = await render({ items, ...state });
    assert.ok(!html.includes("https://fixture.invalid/tv"));
    assert.ok(!html.includes("management-title"));
  }
  assert.ok((await render()).includes("No services assigned."));
});
