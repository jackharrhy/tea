import { it, expect } from "vitest";
import { playerJSON, playerDocument } from "../app/player-widget.ts";
it("keeps ordered tracks, nullable titles and source customization", () => {
  const tracks = [
    {
      id: 7,
      title: null,
      storage_path: "alice/one.mp3",
      mime_type: "audio/mpeg",
    },
    {
      id: 3,
      title: "<Two>",
      storage_path: "alice/two.mp3",
      mime_type: "audio/mpeg",
    },
  ];
  expect(playerJSON("alice", tracks)).toEqual({ username: "alice", tracks });
  const html = playerDocument(
    {
      player_css: "body{color:purple}",
      player_html: '<aside id="footer">custom</aside>',
    },
    tracks,
  );
  expect(html).toContain('data-idx="0" onclick="playTrack(0)"');
  expect(html).toContain("one.mp3");
  expect(html).toContain("&lt;Two&gt;");
  expect(html).toContain("body{color:purple}");
  expect(html).toContain('<aside id="footer">custom</aside>');
  expect(playerDocument({}, [])).toContain('<p class="empty">no tracks</p>');
  expect(playerDocument({}, [])).not.toContain("<audio");
});
