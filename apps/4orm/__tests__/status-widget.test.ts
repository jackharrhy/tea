import { expect, it } from "vitest";
import { statusJSON, statusDocument } from "../app/status-widget.ts";
it("uses source relative-time boundaries and handles timezone-free stored timestamps", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  for (const [age, text] of [
    [-1, "just now"],
    [59, "just now"],
    [60, "1m ago"],
    [3599, "59m ago"],
    [3600, "1h ago"],
    [86400, "1d ago"],
  ] as const) {
    const owner = {
      username: "alice",
      status_updated_at: new Date(now - age * 1000)
        .toISOString()
        .replace("T", " ")
        .replace("Z", ""),
    };
    expect(statusJSON(owner, now).relative_time).toBe(text);
  }
  expect(() =>
    statusJSON({ username: "alice", status_updated_at: "invalid" }, now),
  ).toThrow("Invalid persisted status timestamp");
  expect(statusJSON({ username: "alice" }, now)).toEqual({
    username: "alice",
    status_emoji: "",
    status_text: "",
    relative_time: "",
  });
});
it("retains original status customization and escapes status text", () => {
  const html = statusDocument({
    username: "alice",
    status_text: "<script>text</script>",
    status_emoji: "☀️",
    status_css: "body {color:purple}",
    status_html: '<aside id="custom">Footer</aside>',
  });
  expect(html).toContain("&lt;script&gt;text&lt;/script&gt;");
  expect(html).toContain("body {color:purple}");
  expect(html).toContain('</div>\n    <aside id="custom">Footer</aside>');
  expect(statusDocument({ username: "alice" })).not.toContain(
    '<div class="status">',
  );
});
