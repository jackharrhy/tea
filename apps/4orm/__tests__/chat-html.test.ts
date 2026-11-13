import { expect, it } from "vitest";
import { chatMessageHTML, chatPresenceHTML } from "../app/chat-html.ts";
it("escapes stored and streamed chat content with the source HTML contract", () => {
  expect(
    chatMessageHTML({
      username: "alice",
      message: `<script>x</script> & 'quoted'`,
    }),
  ).toBe(
    '<div class="chat-msg" style=""><a href="/u/alice" class="chat-user">alice</a><span class="chat-text">&lt;script&gt;x&lt;/script&gt; &amp; &#x27;quoted&#x27;</span></div>',
  );
  expect(chatPresenceHTML([{ username: "<alice>", state: "idle" }])).toBe(
    '<span class="chat-present">🟡 &lt;alice&gt;</span>',
  );
});
it("fades old history without fading newly delivered messages", () => {
  expect(
    chatMessageHTML({ username: "alice", message: "Old" }, 0, 100),
  ).toContain('style="opacity: 0.05"');
  expect(
    chatMessageHTML({ username: "alice", message: "New" }, 99, 100),
  ).toContain('style=""');
  expect(chatPresenceHTML([])).toBe('<span class="muted">nobody here</span>');
});
