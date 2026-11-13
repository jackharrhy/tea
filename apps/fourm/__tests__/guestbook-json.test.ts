import { expect, it } from "vitest";
import { guestbookJSON } from "../app/view-json.ts";
it("matches source guestbook fields without exposing local ownership columns", () => {
  const snapshot = {
    owner: { username: "fixture" },
    entries: [
      {
        id: 4,
        username: "author",
        display_name: "Author",
        author_id: 72,
        user_id: 41,
        message: "<b>Message</b>",
        created_at: "2026-11-13 01:00:00.000000",
      },
    ],
  };
  expect(guestbookJSON(snapshot, false)).toEqual({
    owner_username: "fixture",
    can_post: false,
    entries: [
      {
        id: 4,
        author_username: "author",
        author_display_name: "Author",
        message: "<b>Message</b>",
        created_at: "2026-11-13T01:00:00",
      },
    ],
  });
  expect(guestbookJSON({ ...snapshot, entries: [] }, true)).toEqual({
    owner_username: "fixture",
    entries: [],
    can_post: true,
  });
});
