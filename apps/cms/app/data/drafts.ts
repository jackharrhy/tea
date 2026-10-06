import { transaction } from "./transaction.ts";
import { randomUUID } from "node:crypto";
import type { ContentStore, SaveResult } from "./content.ts";
import type { Page } from "../ui/public/content-types.ts";

export function editorPage(store: ContentStore, slug: string): Page | null {
  const row = store.sqlite
    .prepare("SELECT * FROM page_drafts WHERE slug=?")
    .get(slug);
  const published = slug ? store.page(slug) : store.homepage();
  return row
    ? {
        ...JSON.parse(row.snapshot as string),
        revision: row.revision as string,
        hasDraft: true,
        published: !!published,
      }
    : published
      ? { ...published, hasDraft: false, published: true }
      : null;
}

export function saveDraft(
  store: ContentStore,
  slug: string,
  value: Pick<Page, "title" | "blocks" | "seo">,
  expected: string,
): SaveResult {
  return transaction(store.sqlite, () => {
    const before = editorPage(store, slug);
    if (!before) return { ok: false, status: 404, error: "Page not found." };
    if (before.revision !== expected)
      return {
        ok: false,
        status: 409,
        error:
          "This draft changed in another tab. Your edits are still here; reload before saving.",
      };
    const revision = randomUUID();
    const published = slug ? store.page(slug) : store.homepage();
    store.history(slug ? "page" : "homepage", before.id, before);
    store.sqlite
      .prepare(
        `INSERT INTO page_drafts (slug,snapshot,revision,published_revision) VALUES (?,?,?,?)
      ON CONFLICT(slug) DO UPDATE SET snapshot=excluded.snapshot,revision=excluded.revision,updated_at=datetime('now')`,
      )
      .run(
        slug,
        JSON.stringify({
          ...before,
          title: value.title,
          blocks: value.blocks,
          seo: value.seo,
        }),
        revision,
        published?.revision ?? null,
      );
    return { ok: true, revision };
  });
}

export function publishDraft(
  store: ContentStore,
  slug: string,
  expected: string,
): SaveResult {
  return transaction(store.sqlite, () => {
    const draft = editorPage(store, slug);
    if (!draft) return { ok: false, status: 404, error: "Page not found." };
    if (draft.revision !== expected)
      return {
        ok: false,
        status: 409,
        error: "The draft changed. Reload and review it before publishing.",
      };
    const row = store.sqlite
      .prepare("SELECT published_revision FROM page_drafts WHERE slug=?")
      .get(slug);
    if (!row) return { ok: true, revision: draft.revision };
    const published = slug ? store.page(slug) : store.homepage();
    if ((published?.revision ?? null) !== row.published_revision)
      return {
        ok: false,
        status: 409,
        error:
          "The published page changed outside this draft. Keep your draft; reconcile it with the published version before publishing.",
      };
    if (!published)
      store.sqlite
        .prepare("INSERT INTO pages (id,slug,title,blocks) VALUES (?,?,?,?)")
        .run(draft.id, slug, draft.title, "[]");
    const result = store.savePage(
      slug,
      draft,
      (slug ? store.page(slug)! : store.homepage()).revision,
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    store.sqlite.prepare("DELETE FROM page_drafts WHERE slug=?").run(slug);
    return result;
  });
}
