import { expect, it, vi } from "vitest";
import { HullDraft } from "../src/render/hull-draft.js";

it("keeps pointer previews out of history and drops redo after a new point", () => {
  const notify = vi.fn();
  const draft = new HullDraft(notify, vi.fn());
  draft.replace([[0, 0, 0]], "perspective");
  draft.setPreview([[16, 0, 0]]);
  draft.changeHistory("undo");
  expect(draft.points).toEqual([]);
  expect(draft.preview).toEqual([]);
  expect(draft.canRedo).toBe(true);
  draft.changeHistory("redo");
  expect(draft.points).toEqual([[0, 0, 0]]);
  draft.replace(
    [
      [0, 0, 0],
      [0, 0, 0],
    ],
    "perspective",
  );
  draft.changeHistory("undo");
  expect(draft.points).toEqual([]); // duplicate placement added no history entry
  draft.replace([[32, 0, 0]], "perspective");
  expect(draft.canRedo).toBe(false);
});

it("restores history after a rejected commit and clears it after a successful commit", () => {
  let reject = true;
  const draft = new HullDraft((event) => {
    if (event.phase === "commit") {
      expect(draft.hasHistory).toBe(false); // observers see canonical undo at commit
      if (reject) throw new Error("invalid hull");
    }
  }, vi.fn());
  draft.replace([[0, 0, 0]], "perspective");
  expect(() => draft.commit()).toThrow("invalid hull");
  expect(draft.points).toEqual([[0, 0, 0]]);
  expect(draft.canUndo).toBe(true);
  reject = false;
  draft.commit();
  expect(draft.points).toEqual([]);
  expect(draft.hasHistory).toBe(false);
});
