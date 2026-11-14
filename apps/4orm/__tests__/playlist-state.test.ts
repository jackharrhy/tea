import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createCommunity } from "../app/data/community.ts";
import type { Row } from "../app/data/community.ts";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const community = createCommunity({
    all(sql, ...values) {
      if (!values.length && sql.includes(";")) {
        db.exec(sql);
        return [];
      }
      const query = db.prepare(sql);
      return query.columns().length
        ? (query.all(...values) as Row[])
        : (query.run(...values), []);
    },
    transaction(fn) {
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  });
  community.restore({
    users: [
      {
        id: 41,
        username: "fixture",
        display_name: "Fixture",
        password_hash: "",
      },
      { id: 72, username: "other", display_name: "Other", password_hash: "" },
    ],
    media: [
      {
        id: 101,
        user_id: 41,
        storage_path: "fixture/first.wav",
        mime_type: "audio/wav",
        size_bytes: 1,
      },
      {
        id: 102,
        user_id: 41,
        storage_path: "fixture/second.wav",
        mime_type: "audio/wav",
        size_bytes: 1,
      },
      {
        id: 103,
        user_id: 72,
        storage_path: "other/song.wav",
        mime_type: "audio/wav",
        size_bytes: 1,
      },
    ],
  });
  return { db, community };
}
it("keeps untitled additions null and preserves playlist IDs and ownership through reorder/remove", () => {
  const { db, community } = fixture();
  try {
    community.addTrack(41, 101);
    community.addTrack(41, 102);
    const before = community.playlist("fixture");
    expect(before.map((row) => row.title)).toEqual([null, null]);
    expect(() => community.addTrack(41, 103)).toThrow("own media");
    community.moveTrack(41, Number(before[1].id), "up");
    expect(community.playlist("fixture").map((row) => row.id)).toEqual([
      before[1].id,
      before[0].id,
    ]);
    community.removeTrack(72, Number(before[0].id));
    expect(community.playlist("fixture")).toHaveLength(2);
    community.removeTrack(41, Number(before[0].id));
    expect(community.playlist("fixture").map((row) => row.id)).toEqual([
      before[1].id,
    ]);
  } finally {
    db.close();
  }
});
it("treats invalid directions and boundary moves as source-compatible no-ops", () => {
  const { db, community } = fixture();
  try {
    community.addTrack(41, 101, "First");
    const before = community.playlist("fixture");
    community.moveTrack(41, Number(before[0].id), "sideways");
    community.moveTrack(41, Number(before[0].id), "up");
    community.moveTrack(41, Number(before[0].id), "down");
    expect(community.playlist("fixture")).toEqual(before);
  } finally {
    db.close();
  }
});
