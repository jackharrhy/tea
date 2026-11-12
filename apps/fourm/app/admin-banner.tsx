import type { Handle } from "remix/component";
import type { Row } from "./data/community.ts";
export function AdminBanner(handle: Handle<{ banner: Row | null }>) {
  return () => (
    <details class="panel" open>
      <summary>
        <h2>site banner</h2>
      </summary>
      <p class="muted">
        show a site-wide message on the home page, forum index, and settings.
        the html and css are trusted admin content.
      </p>
      <form method="post" action="/admin/site-banner" class="stack">
        <label>
          <input
            type="checkbox"
            name="banner_enabled"
            checked={Boolean(handle.props.banner?.banner_enabled)}
          />{" "}
          show banner
        </label>
        <label>
          banner HTML
          <textarea
            id="site-banner-html"
            name="banner_html"
            rows={4}
            defaultValue={String(handle.props.banner?.banner_html ?? "")}
          />
        </label>
        <label>
          banner CSS
          <textarea
            id="site-banner-css"
            name="banner_css"
            rows={6}
            defaultValue={String(handle.props.banner?.banner_css ?? "")}
          />
        </label>
        <button type="submit">save site banner</button>
      </form>
      <h3>preview</h3>
      <iframe
        id="site-banner-preview"
        title="site banner preview"
        sandbox=""
        class="fourm-preview-frame"
      />
    </details>
  );
}
