import { expect, it } from "vitest";
import { counterDocument, counterJSON } from "../app/counter-widget.ts";
it("keeps the source counter response and custom widget placement", () => {
  const owner = {
    username: "alice",
    counter_css: ".counter-number {color:purple}",
    counter_html: '<aside id="custom-counter">Footer</aside>',
  };
  expect(counterJSON(owner, 42)).toEqual({
    username: "alice",
    total_views: 42,
  });
  const html = counterDocument(owner, 42);
  expect(html).toContain("<title>alice counter</title>");
  expect(html).toContain('class="counter-label">alice visitors</div>');
  expect(html).toContain('class="counter-number">42</div>');
  expect(html).toContain(owner.counter_css);
  expect(html.indexOf(owner.counter_html)).toBeGreaterThan(
    html.indexOf('class="counter-number"'),
  );
  expect(counterDocument({ username: '<a "b">' }, 0)).toContain(
    "&lt;a &#34;b&#34;&gt; visitors",
  );
});
