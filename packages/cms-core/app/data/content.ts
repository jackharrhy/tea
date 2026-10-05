import { folderPath } from "../ui/public/folder-path.ts";
import { mediaFolders } from "./media-folders.ts";
import { transaction } from "./transaction.ts";
import { blockReferences } from "../ui/public/block-references.ts";
import type { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { editorPage, saveDraft, publishDraft } from "./drafts.ts";
import type {
  Page,
  Seo,
  Media,
  Adornment,
  Sidebar,
} from "../ui/public/content-types.ts";

const emptySeo: Seo = {
  title: null,
  description: null,
  image_id: null,
  no_index: false,
  canonical: null,
};
export const revision = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type SaveResult =
  | { ok: true; revision: string }
  | { ok: false; error: string; status: number };

export class ContentStore {
  constructor(
    readonly sqlite: DatabaseSync,
    readonly options: { dataDir?: string; canonicalOrigin?: string } = {},
  ) {}
  editorPage(slug: string) {
    return editorPage(this, slug);
  }
  saveDraft(
    slug: string,
    value: Pick<Page, "title" | "blocks" | "seo">,
    expected: string,
  ) {
    return saveDraft(this, slug, value, expected);
  }
  publishDraft(slug: string, expected: string) {
    return publishDraft(this, slug, expected);
  }
  editorPages(): Page[] {
    const slugs = new Set([
      ...this.pages().map((p) => p.slug),
      ...this.sqlite
        .prepare("SELECT slug FROM page_drafts WHERE slug != ''")
        .all()
        .map((r) => r.slug as string),
    ]);
    return [...slugs]
      .map((slug) => this.editorPage(slug)!)
      .toSorted((a, b) => a.title.localeCompare(b.title));
  }
  pages(): Page[] {
    return this.sqlite
      .prepare("SELECT * FROM pages ORDER BY title COLLATE NOCASE")
      .all()
      .map((row) => this.pageFromRow(row));
  }
  page(slug: string): Page | null {
    const row = this.sqlite
      .prepare("SELECT * FROM pages WHERE slug=?")
      .get(slug);
    return row ? this.pageFromRow(row) : null;
  }
  private pageFromRow(
    row: Record<string, import("node:sqlite").SQLOutputValue>,
  ): Page {
    return {
      id: row.id as string,
      slug: row.slug as string,
      title: row.title as string,
      blocks: JSON.parse(row.blocks as string),
      seo: {
        title: row.seo_title as string | null,
        description: row.seo_description as string | null,
        image_id: row.seo_image_id as string | null,
        no_index: !!row.seo_no_index,
        canonical: row.seo_canonical as string | null,
      },
      revision: revision(row),
    };
  }
  homepage(): Page {
    const row = this.sqlite
      .prepare("SELECT * FROM homepage WHERE id='homepage'")
      .get()!;
    const seo = this.preferences().homepage_seo;
    return {
      id: "homepage",
      slug: "",
      title: "Homepage",
      blocks: JSON.parse(row.blocks as string),
      seo: { ...emptySeo, ...seo },
      revision: revision({ row, seo }),
    };
  }
  media(): Media[] {
    const folders = mediaFolders(this);
    return (
      this.sqlite
        .prepare(
          "SELECT media.*,media_details.folder_id,COALESCE(media_details.description,'') AS description FROM media LEFT JOIN media_details ON media.id=media_details.media_id ORDER BY created_at DESC",
        )
        .all() as unknown as Media[]
    ).map((m) => ({
      ...m,
      folder_path: folderPath(folders, m.folder_id ?? null),
    }));
  }
  mediaItem(id: string): Media | null {
    return (
      (this.sqlite
        .prepare("SELECT * FROM media WHERE id=?")
        .get(id) as unknown as Media) ?? null
    );
  }
  adornments(): Adornment[] {
    return this.sqlite
      .prepare("SELECT * FROM adornments ORDER BY name")
      .all()
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        media_id: row.media_id as string | null,
        css: JSON.parse(row.css as string),
        revision: revision(row),
      }));
  }
  sidebar(): Sidebar {
    const row = this.sqlite
      .prepare("SELECT * FROM sidebar WHERE id='sidebar'")
      .get()!;
    return {
      top_image_id: row.top_image_id as string | null,
      categories: JSON.parse(row.categories as string),
      links: JSON.parse(row.links as string),
      revision: revision(row),
    };
  }
  preferences() {
    const row = this.sqlite
      .prepare("SELECT * FROM site_preferences WHERE id='preferences'")
      .get()!;
    return {
      site_name: row.site_name as string,
      canonical_origin:
        this.options.canonicalOrigin ?? (row.canonical_origin as string),
      analytics_id: String(row.analytics_id ?? ""),
      analytics_enabled: !!row.analytics_enabled,
      description: row.description as string,
      homepage_seo: JSON.parse(row.homepage_seo as string) as Partial<Seo>,
    };
  }
  site() {
    const row = this.sqlite
      .prepare("SELECT * FROM site WHERE id='site'")
      .get()!;
    const preferences = this.preferences();
    return {
      ...preferences,
      background_color: row.background_color as string,
      revision: revision({ row, preferences }),
    };
  }
  savePage(
    slug: string,
    page: Pick<Page, "title" | "blocks" | "seo">,
    expected: string,
  ): SaveResult {
    return transaction(this.sqlite, () => {
      const before = slug ? this.page(slug) : this.homepage();
      if (!before)
        return { ok: false, status: 404, error: "This page no longer exists." };
      if (before.revision !== expected)
        return {
          ok: false,
          status: 409,
          error:
            "This page changed in another tab. Your edits are still here; reload the latest version before saving.",
        };
      this.history(slug ? "page" : "homepage", before.id, before);
      const seo = { ...emptySeo, ...page.seo };
      if (slug)
        this.sqlite
          .prepare(
            `UPDATE pages SET title=?,blocks=?,seo_title=?,seo_description=?,seo_image_id=?,seo_no_index=?,seo_canonical=?,updated_at=datetime('now') WHERE slug=?`,
          )
          .run(
            page.title,
            JSON.stringify(page.blocks),
            seo.title,
            seo.description,
            seo.image_id,
            seo.no_index ? 1 : 0,
            seo.canonical,
            slug,
          );
      else {
        this.sqlite
          .prepare(
            "UPDATE homepage SET blocks=?,updated_at=datetime('now') WHERE id='homepage'",
          )
          .run(JSON.stringify(page.blocks));
        this.sqlite
          .prepare(
            "UPDATE site_preferences SET homepage_seo=? WHERE id='preferences'",
          )
          .run(JSON.stringify(seo));
      }
      return {
        ok: true,
        revision: (slug ? this.page(slug)! : this.homepage()).revision,
      };
    });
  }
  createPage(title: string, slug: string) {
    return transaction(this.sqlite, () => {
      if (this.editorPage(slug))
        return {
          ok: false as const,
          status: 409,
          error: "That URL is already in use.",
        };
      const page = { id: randomUUID(), slug, title, blocks: [], seo: emptySeo };
      this.sqlite
        .prepare(
          "INSERT INTO page_drafts (slug,snapshot,revision) VALUES (?,?,?)",
        )
        .run(slug, JSON.stringify(page), randomUUID());
      return { ok: true as const, page: this.editorPage(slug)! };
    });
  }
  deletePage(slug: string, expected: string): SaveResult {
    return transaction(this.sqlite, () => {
      const page = this.editorPage(slug);
      if (!page) return { ok: false, status: 404, error: "Page not found." };
      if (page.revision !== expected)
        return {
          ok: false,
          status: 409,
          error: "Page changed. Reload before removing it.",
        };
      if (
        this.sidebar().categories.some((c) =>
          c.items.some((i) => i.pageSlug === slug),
        )
      )
        return {
          ok: false,
          status: 409,
          error: "Remove this page from Navigation before deleting it.",
        };
      this.history("page", page.id, page);
      this.sqlite.prepare("DELETE FROM pages WHERE slug=?").run(slug);
      this.sqlite.prepare("DELETE FROM page_drafts WHERE slug=?").run(slug);
      return { ok: true, revision: "" };
    });
  }
  saveSidebar(
    value: Pick<Sidebar, "top_image_id" | "categories" | "links">,
    expected: string,
  ): SaveResult {
    return transaction(this.sqlite, () => {
      const before = this.sidebar();
      if (before.revision !== expected)
        return {
          ok: false,
          status: 409,
          error: "Navigation changed. Reload before saving.",
        };
      this.history("sidebar", "sidebar", before);
      this.sqlite
        .prepare(
          "UPDATE sidebar SET top_image_id=?,categories=?,links=?,updated_at=datetime('now') WHERE id='sidebar'",
        )
        .run(
          value.top_image_id,
          JSON.stringify(value.categories),
          JSON.stringify(value.links),
        );
      return { ok: true, revision: this.sidebar().revision };
    });
  }
  saveSite(
    value: Pick<
      ReturnType<ContentStore["site"]>,
      "site_name" | "description" | "background_color" | "canonical_origin"
    > &
      Partial<
        Pick<
          ReturnType<ContentStore["site"]>,
          "analytics_id" | "analytics_enabled"
        >
      >,
    expected: string,
  ): SaveResult {
    return transaction(this.sqlite, () => {
      if (this.site().revision !== expected)
        return {
          ok: false,
          status: 409,
          error: "Settings changed. Reload before saving.",
        };
      this.sqlite
        .prepare(
          "UPDATE site SET background_color=?,updated_at=datetime('now') WHERE id='site'",
        )
        .run(value.background_color);
      this.sqlite
        .prepare(
          "UPDATE site_preferences SET site_name=?,canonical_origin=?,description=?,analytics_id=?,analytics_enabled=? WHERE id='preferences'",
        )
        .run(
          value.site_name,
          this.options.canonicalOrigin ?? value.canonical_origin,
          value.description,
          value.analytics_id ?? "",
          value.analytics_enabled ? 1 : 0,
        );
      return { ok: true, revision: this.site().revision };
    });
  }
  mediaUsage(): Record<string, string[]> {
    const usage = new Map<string, Set<string>>();
    function add(id: string | null | undefined, label: string) {
      if (!id) return;
      if (!usage.has(id)) usage.set(id, new Set());
      usage.get(id)!.add(label);
    }
    for (const page of [
      ...this.pages(),
      this.homepage(),
      ...this.editorPages(),
      this.editorPage("")!,
    ]) {
      for (const id of blockReferences(page.blocks).media) add(id, page.title);
      add(page.seo.image_id, page.title);
    }
    const sidebar = this.sidebar();
    add(sidebar.top_image_id, "Navigation");
    for (const category of sidebar.categories)
      add(category.backgroundImageId, "Navigation");
    for (const art of this.adornments())
      add(art.media_id, "Adornment: " + art.name);
    return Object.fromEntries(
      [...usage].map(([id, labels]) => [id, [...labels]]),
    );
  }
  mediaReferences(id: string): string[] {
    return this.mediaUsage()[id] ?? [];
  }
  adornmentReferences(name: string) {
    return [
      ...this.pages(),
      this.homepage(),
      ...this.editorPages(),
      this.editorPage("")!,
    ]
      .filter((p) => blockReferences(p.blocks).adornments.has(name))
      .map((p) => p.title);
  }
  history(kind: string, id: string, snapshot: unknown) {
    this.sqlite
      .prepare(
        "INSERT INTO content_history (kind,content_id,snapshot) VALUES (?,?,?)",
      )
      .run(kind, id, JSON.stringify(snapshot));
  }
}
