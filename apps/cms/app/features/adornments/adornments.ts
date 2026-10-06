import { randomUUID } from "node:crypto";
import { transaction } from "../../data/transaction.ts";
import type { ContentStore } from "../../data/content.ts";
import type { Adornment } from "../../ui/public/content-types.ts";

type AdornmentInput = Pick<
  Adornment,
  "name" | "media_id" | "css" | "revision"
> & { id?: string };
export function saveAdornment(store: ContentStore, value: AdornmentInput) {
  return transaction(store.sqlite, () => {
    const items = store.adornments(),
      existing = items.find((a) => a.id === value.id);
    const name = value.name.trim();
    if (!value.media_id || !store.mediaItem(value.media_id))
      return {
        ok: false as const,
        status: 400,
        error: "Choose existing artwork.",
      };
    if (value.id && !existing)
      return { ok: false as const, status: 404, error: "Adornment not found." };
    if (existing && value.revision !== existing.revision)
      return {
        ok: false as const,
        status: 409,
        error: "This adornment changed. Reopen it before saving.",
      };
    if (items.some((a) => a.name === name && a.id !== value.id))
      return {
        ok: false as const,
        status: 409,
        error: "An adornment already has that name.",
      };
    if (
      existing &&
      existing.name !== name &&
      store.adornmentReferences(existing.name).length
    )
      return {
        ok: false as const,
        status: 409,
        error:
          "This adornment is in use. Remove its placements before renaming.",
      };
    if (existing) {
      store.history("adornment", existing.id, existing);
      store.sqlite
        .prepare("UPDATE adornments SET name=?,media_id=?,css=? WHERE id=?")
        .run(name, value.media_id, JSON.stringify(value.css), existing.id);
    } else {
      store.sqlite
        .prepare(
          "INSERT INTO adornments (id,name,media_id,css) VALUES (?,?,?,?)",
        )
        .run(randomUUID(), name, value.media_id, JSON.stringify(value.css));
    }
    return { ok: true as const, items: store.adornments() };
  });
}
export function deleteAdornment(store: ContentStore, id: string) {
  return transaction(store.sqlite, () => {
    const item = store.adornments().find((a) => a.id === id);
    if (!item)
      return { ok: false as const, status: 404, error: "Adornment not found." };
    const refs = store.adornmentReferences(item.name);
    if (refs.length)
      return {
        ok: false as const,
        status: 409,
        error: "Still used by " + refs.join(", ") + ".",
      };
    store.history("adornment", id, item);
    store.sqlite.prepare("DELETE FROM adornments WHERE id=?").run(id);
    return { ok: true as const };
  });
}
