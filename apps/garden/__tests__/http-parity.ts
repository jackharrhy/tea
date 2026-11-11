import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fromHtml } from "hast-util-from-html";
import { visit } from "unist-util-visit";
import { createContentStore } from "../app/content/store.ts";

type RootContent = ReturnType<typeof fromHtml>["children"][number];
type Element = Extract<RootContent, { type: "element" }>;

const before = process.env.GARDEN_BEFORE_URL || "http://127.0.0.1:4321";
const after = process.env.GARDEN_AFTER_URL || "http://127.0.0.1:4322";
const entries = createContentStore(
  process.env.GARDEN_VAULT_PATH || "./vault/Garden",
).read().entries;
function text(node: RootContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element" || ["style", "script"].includes(node.tagName))
    return "";
  const value = node.children.map(text).join("");
  return [
    "p",
    "li",
    "pre",
    "br",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "summary",
  ].includes(node.tagName)
    ? value + " "
    : value;
}
function contents(html: string) {
  let main: Element | undefined;
  visit(fromHtml(html), "element", (node) => {
    if (node.tagName === "main") main = node;
  });
  assert.ok(main, "Missing main element");
  const links: string[] = [];
  visit(main, "element", (node) => {
    if (node.tagName === "a") links.push(String(node.properties.href));
  });
  return { text: text(main).replace(/\s+/g, " ").trim(), links };
}
const results = [];
for (const entry of entries) {
  const pathname = entry.id === "home" ? "/" : "/" + entry.id;
  const one = await fetch(before + pathname, { redirect: "manual" });
  const two = await fetch(after + pathname, { redirect: "manual" });
  const a = contents(await one.text());
  const b = contents(await two.text());
  results.push({
    pathname,
    statusEqual: one.status === two.status,
    textEqual: a.text === b.text,
    linksEqual: JSON.stringify(a.links) === JSON.stringify(b.links),
  });
}
await fs.mkdir("tmp/parity", { recursive: true });
await fs.writeFile(
  path.resolve("tmp/parity/http-report.json"),
  JSON.stringify(results, null, 2),
);
const failures = results.filter(
  (result) => !result.statusEqual || !result.textEqual || !result.linksEqual,
);
console.log(JSON.stringify({ pages: results.length, failures }, null, 2));
assert.equal(
  failures.length,
  0,
  "HTTP parity failed; see tmp/parity/http-report.json",
);
