import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { postContent } from "../app/rendering.ts";
process.umask(0o077);
const origin = "http://127.0.0.1:18964";
const output =
  "/home/jack/.local/state/form-harrhy-integration/candidate/post-rendering-" +
  new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
async function json(path) {
  const response = await fetch(origin + path, {
    headers: { Accept: "application/json" },
  });
  assert.equal(response.status, 200);
  return response.json();
}
const first = await json("/forum");
let threads = [...first.threads];
for (let page = 2; page <= first.total_pages; page++)
  threads.push(...(await json("/forum?page=" + page)).threads);
assert.equal(threads.length, first.total);
let posts = 0,
  checks = 0;
const differences = [];
for (const thread of threads) {
  const firstPage = await json("/forum/" + thread.id);
  let seen = 0;
  for (let page = 1; page <= firstPage.total_pages; page++) {
    const detail =
      page === 1 ? firstPage : await json(`/forum/${thread.id}?page=${page}`);
    for (const post of detail.posts) {
      seen++;
      posts++;
      for (const [field, source, format] of [
        ["rendered_content", post.content, post.content_format],
        [
          "rendered_quoted_content",
          post.quoted_content,
          post.quoted_content_format || "bbcode",
        ],
        ["rendered_signature", post.author_signature, "bbcode"],
      ]) {
        const rendered = source ? postContent(source, format) : "";
        checks++;
        if (rendered !== post[field])
          differences.push({
            postId: post.id,
            threadId: thread.id,
            field,
            format,
            source,
            oracle: post[field],
            native: rendered,
          });
      }
    }
  }
  assert.equal(seen, firstPage.total_posts);
}
await writeFile(
  output + "/differences.json",
  JSON.stringify(differences, null, 2),
);
const receipt = {
  status: differences.length ? "FAIL" : "PASS",
  threads: threads.length,
  posts,
  checks,
  differences: differences.length,
  productionTouched: false,
};
await writeFile(output + "/receipt.json", JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ ...receipt, output }));
process.exitCode = differences.length ? 1 : 0;
