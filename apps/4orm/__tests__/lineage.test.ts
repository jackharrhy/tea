import { expect, it } from "vitest";
import { inviteTree } from "../app/lineage.ts";
it("matches source tree nesting and creation-order input without exposing IDs", () => {
  const tree = inviteTree([
    { id: 9, username: "child", display_name: "Child", invited_by_user_id: 3 },
    {
      id: 3,
      username: "parent",
      display_name: "Parent",
      invited_by_user_id: null,
    },
    {
      id: 7,
      username: "orphan",
      display_name: "Orphan",
      invited_by_user_id: 100,
    },
    {
      id: 5,
      username: "second-child",
      display_name: "Second child",
      invited_by_user_id: 3,
    },
  ]);
  expect(tree).toEqual([
    {
      username: "parent",
      display_name: "Parent",
      children: [
        { username: "child", display_name: "Child", children: [] },
        {
          username: "second-child",
          display_name: "Second child",
          children: [],
        },
      ],
    },
    { username: "orphan", display_name: "Orphan", children: [] },
  ]);
  expect(inviteTree([])).toEqual([]);
});
