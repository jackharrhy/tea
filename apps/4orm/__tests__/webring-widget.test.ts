import { expect, it } from "vitest";
import { webringJSON, webringDocument } from "../app/webring-widget.ts";
it("preserves parent navigation and escapes member labels", () => {
  const ring = {
    previous: { username: "alice", display_name: "<Alice>" },
    next: { username: "bob", display_name: "Bob" },
  };
  expect(webringJSON("alice", ring)).toEqual({
    username: "alice",
    prev: ring.previous,
    next: ring.next,
  });
  const html = webringDocument(ring);
  expect(html).toContain('target="_parent">← &lt;Alice&gt;</a>');
  expect(html).toContain('target="_parent">Bob →</a>');
  expect(html).toContain('class="label">🔗');
  expect(webringJSON("outsider", { previous: null, next: null })).toEqual({
    username: "outsider",
    prev: null,
    next: null,
  });
});
