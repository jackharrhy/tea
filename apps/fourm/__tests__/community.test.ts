import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createCommunity } from "../app/data/community.ts";
import type { Row } from "../app/data/community.ts";

function fixture(forumRateLimit = false) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const community = createCommunity(
    {
      all(sql, ...values) {
        if (!values.length && sql.includes(";")) {
          sqlite.exec(sql);
          return [];
        }
        const statement = sqlite.prepare(sql);
        return statement.columns().length
          ? (statement.all(...values) as Row[])
          : (statement.run(...values), []);
      },
      transaction(operation) {
        sqlite.exec("BEGIN");
        try {
          const result = operation();
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    },
    { forumRateLimit },
  );
  community.restore({
    users: [
      {
        id: 41,
        username: "jane",
        display_name: "Jane",
        password_hash: "",
        is_admin: 1,
      },
      {
        id: 72,
        username: "sam",
        display_name: "Sam",
        password_hash: "",
        is_admin: 0,
      },
    ],
    external_identities: [
      {
        issuer: "https://fixture.example",
        subject: "subject-jane",
        user_id: 41,
      },
      {
        issuer: "https://fixture.example",
        subject: "subject-sam",
        user_id: 72,
      },
    ],
  });
  return { community, sqlite };
}

describe("community persistence and authority", () => {
  it("uses exact issuer and subject links, never a matching name", () => {
    const { community } = fixture();
    expect(
      community.resolveIdentity("https://fixture.example", "subject-jane").id,
    ).toBe(41);
    expect(() =>
      community.resolveIdentity("https://other.example", "subject-jane"),
    ).toThrow();
    expect(() =>
      community.resolveIdentity("https://fixture.example", "jane"),
    ).toThrow();
  });
  it("keeps private pages private and scopes writes to their owner", () => {
    const { community } = fixture();
    community.savePage(41, "draft", {
      title: "Draft",
      content: "Only Jane",
      is_public: 0,
    });
    expect(community.pages(41, null)).toEqual([]);
    expect(() => community.page(41, "draft", 72)).toThrow();
    expect(() => community.deletePage(72, "draft")).toThrow();
    expect(community.page(41, "draft", 41).content).toBe("Only Jane");
  });
  it("locks replies for members, permits admin moderation, and keeps post ownership", () => {
    const { community } = fixture();
    const thread = community.createThread(41, "Hello", "First post", "bbcode");
    const reply = community.reply(72, thread, "Hi Jane", "markdown");
    expect(() => community.editPost(72, 1, "Taken over", "html")).toThrow();
    community.moderate(41, thread, "lock");
    expect(() => community.reply(72, thread, "Another", "html")).toThrow();
    expect(() => community.moderate(72, thread, "delete")).toThrow();
    community.editPost(72, reply, "Edited reply", "markdown");
    expect(community.thread(thread).posts[1].is_edited).toBe(1);
  });
  it("revokes local sessions immediately when an admin disables a member", () => {
    const { community } = fixture();
    community.createSession("a".repeat(64), 72, Date.now() + 10000);
    expect(community.session("a".repeat(64))?.id).toBe(72);
    community.setDisabled(41, 72, true);
    expect(community.session("a".repeat(64))).toBeNull();
    expect(() => community.sendChat(72, "Should be denied")).toThrow();
  });
  it("consumes an OAuth transaction only once", () => {
    const { community } = fixture();
    community.saveLogin("state-hash", "transaction");
    expect(community.consumeLogin("state-hash")).toBe("transaction");
    expect(community.consumeLogin("state-hash")).toBeNull();
  });
  it("advances chat through a full 200-message page without skipping the next batch", () => {
    const { community } = fixture();
    for (let i = 0; i < 203; i++) community.sendChat(41, `Message ${i}`);
    const first = community.chat(72, 0);
    expect(first).toHaveLength(200);
    expect(community.chat(72, Number(first.at(-1)!.id))).toHaveLength(3);
  });
  it("reserves scarce invites and creates a member only after the exact claimed callback", () => {
    const { community, sqlite } = fixture();
    community.createInvite(41, "one-place", 1);
    community.reserveEnrollment("one-place", "registration-1", null);
    expect(() =>
      community.reserveEnrollment("one-place", "registration-2", null),
    ).toThrow();
    expect(
      sqlite
        .prepare("SELECT uses_count FROM invites WHERE code='one-place'")
        .get()?.uses_count,
    ).toBe(0);
    community.claimEnrollment(
      "registration-1",
      "https://fixture.example",
      "new-subject",
      "alex",
      "Alex",
    );
    expect(() =>
      community.finishEnrollment(
        "registration-1",
        "https://fixture.example",
        "another-subject",
      ),
    ).toThrow();
    const actor = community.finishEnrollment(
      "registration-1",
      "https://fixture.example",
      "new-subject",
    );
    expect(actor.is_admin).toBe(0);
    expect(
      sqlite.prepare("SELECT password_hash FROM users WHERE id=?").get(actor.id)
        ?.password_hash,
    ).toBe("");
    expect(
      community.completionProof("registration-1", "https://fixture.example"),
    ).toMatchObject({ userId: actor.id, createdProfile: true, enabled: true });
    expect(
      community.finishEnrollment(
        "registration-1",
        "https://fixture.example",
        "new-subject",
      ).id,
    ).toBe(actor.id);
  });
  it("keeps original grant reservations and terminal receipts durable past invite expiry", () => {
    const { community, sqlite } = fixture();
    community.createInvite(41, "completion", 1);
    community.reserveEnrollment("completion", "registration", null);
    community.claimEnrollment(
      "registration",
      "https://fixture.example",
      "new-subject",
      "alex",
      "Alex",
    );
    community.finishEnrollment(
      "registration",
      "https://fixture.example",
      "new-subject",
    );
    sqlite
      .prepare(
        "UPDATE auth_enrollments SET expires_at=1 WHERE id='registration'",
      )
      .run();
    expect(
      community.reserveGrant(
        "registration",
        "https://fixture.example",
        "maps",
        "new-subject",
        "original",
      ).attemptId,
    ).toBe("original");
    expect(
      community.reserveGrant(
        "registration",
        "https://fixture.example",
        "maps",
        "new-subject",
        "retry",
      ).attemptId,
    ).toBe("original");
    expect(() =>
      community.finishGrant(
        "registration",
        "https://fixture.example",
        "maps",
        "new-subject",
        "retry",
        "grant-1",
        "created",
      ),
    ).toThrow();
    expect(
      community.finishGrant(
        "registration",
        "https://fixture.example",
        "maps",
        "new-subject",
        "original",
        "grant-1",
        "created",
      ).state,
    ).toBe("done");
    expect(() =>
      community.finishGrant(
        "registration",
        "https://fixture.example",
        "maps",
        "new-subject",
        "original",
        "replacement",
        "created",
      ),
    ).toThrow();
    expect(community.recordDelivery("registration", 200)).toBe(502);
    community.reserveGrant(
      "registration",
      "https://fixture.example",
      "burger",
      "new-subject",
      "burger-attempt",
    );
    community.finishGrant(
      "registration",
      "https://fixture.example",
      "burger",
      "new-subject",
      "burger-attempt",
      "grant-2",
      "preserved",
    );
    expect(community.recordDelivery("registration", 200)).toBe(200);
    expect(community.pendingCompletions()).toEqual([]);
  });
  it("does not consume an invite or fan out when an existing linked member re-enrolls", () => {
    const { community, sqlite } = fixture();
    community.createInvite(41, "existing-member", 1);
    community.reserveEnrollment("existing-member", "existing-request", null);
    community.claimEnrollment(
      "existing-request",
      "https://fixture.example",
      "subject-sam",
      "invented-name",
      "Invented name",
    );
    expect(
      community.finishEnrollment(
        "existing-request",
        "https://fixture.example",
        "subject-sam",
      ).id,
    ).toBe(72);
    expect(
      sqlite
        .prepare("SELECT uses_count FROM invites WHERE code='existing-member'")
        .get()?.uses_count,
    ).toBe(0);
    expect(
      community.completionProof("existing-request", "https://fixture.example")
        .createdProfile,
    ).toBe(false);
    expect(() =>
      community.reserveGrant(
        "existing-request",
        "https://fixture.example",
        "maps",
        "subject-sam",
        "no-new-grant",
      ),
    ).toThrow();
  });
  it("charges in-flight uploads against quota and denies another owner's deletion", () => {
    const { community, sqlite } = fixture();
    sqlite
      .prepare(
        "INSERT INTO media(user_id,storage_path,mime_type,size_bytes) VALUES(41,'jane/existing','application/octet-stream',?)",
      )
      .run(495 * 1024 * 1024);
    community.reserveUpload(41, "jane/reserved", "image/png", 4 * 1024 * 1024);
    expect(() =>
      community.reserveUpload(
        41,
        "jane/over-quota",
        "image/png",
        2 * 1024 * 1024,
      ),
    ).toThrow();
    const uploaded = community.finishUpload(41, "jane/reserved");
    expect(() => community.deleteMedia(72, Number(uploaded.id))).toThrow();
    expect(community.publishedMedia("jane/reserved").user_id).toBe(41);
    community.deleteMedia(41, Number(uploaded.id));
    expect(() => community.publishedMedia("jane/reserved")).toThrow();
    expect(community.pendingMediaDeletes()[0].storage_path).toBe(
      "jane/reserved",
    );
  });
  it("preserves guestbook ownership, including when the author is an admin", () => {
    const { community } = fixture();
    community.signGuestbook(41, "sam", "A signed message");
    const entry = community.guestbook("sam").entries[0];
    expect(() =>
      community.deleteGuestbook(41, "sam", Number(entry.id)),
    ).toThrow();
    community.deleteGuestbook(72, "sam", Number(entry.id));
    expect(community.guestbook("sam").entries).toEqual([]);
  });
  it("keeps playlists and avatars scoped to owned media and preserves reorder IDs", () => {
    const { community, sqlite } = fixture();
    sqlite.exec(
      "INSERT INTO media(id,user_id,storage_path,mime_type,size_bytes) VALUES(5,41,'jane/image.png','image/png',1),(6,41,'jane/song.mp3','audio/mpeg',1),(7,72,'sam/song.mp3','audio/mpeg',1)",
    );
    expect(() => community.addTrack(72, 6, "Not my file")).toThrow();
    expect(() => community.setAvatar(72, 5)).toThrow();
    community.setAvatar(41, 5);
    expect(community.profile("jane").avatar_path).toBe("jane/image.png");
    community.addTrack(41, 6, "First");
    community.addTrack(41, 5, "Second");
    const before = community.playlist("jane");
    community.moveTrack(41, Number(before[1].id), "up");
    expect(community.playlist("jane").map((row) => row.id)).toEqual([
      before[1].id,
      before[0].id,
    ]);
    community.removeTrack(72, Number(before[0].id));
    expect(community.playlist("jane")).toHaveLength(2);
  });
  it("deduplicates counter visits and keeps disabled members out of public and presence views", () => {
    const { community } = fixture();
    expect(community.counter("jane", "opaque-visitor").total_views).toBe(1);
    expect(community.counter("jane", "opaque-visitor").total_views).toBe(1);
    expect(community.counter("jane", "another-visitor").total_views).toBe(2);
    community.setWebring(41, true);
    community.setWebring(72, true);
    expect(community.webring("jane").next?.username).toBe("sam");
    community.presence(41);
    expect(community.presence(72)).toHaveLength(2);
    expect(community.presence(72)).toHaveLength(2);
    community.setDisabled(41, 72, true);
    expect(community.presence(41)).toHaveLength(1);
    expect(community.webring("jane").members).toHaveLength(1);
    expect(community.members()).toHaveLength(1);
  });
});

it("preserves existing multi-megabyte Unicode pages within native SQL value limits", () => {
  const { community, sqlite } = fixture();
  const content = "🌍漢字".repeat(300_000);
  const page = community.savePage(41, "large.html", {
    title: "Large existing page",
    content,
    content_format: "html",
    is_public: 1,
  });
  expect(page.content).toBe(content);
  const largest = sqlite
    .prepare(
      "SELECT MAX(length(cast(content AS BLOB))) AS bytes FROM page_content_chunks",
    )
    .get();
  expect(Number(largest?.bytes)).toBeLessThan(1_000_000);
  expect(
    community.exportArchive(41).pages.find((row) => row.id === page.id)
      ?.content,
  ).toBe(content);
  community.savePage(41, "large.html", {
    title: "Edited",
    content: "small",
    content_format: "html",
    is_public: 1,
  });
  expect(community.page(41, "large.html", 41).content).toBe("small");
  expect(
    sqlite.prepare("SELECT count(*) AS n FROM page_content_chunks").get()?.n,
  ).toBe(0);
});

it("saves the source settings sections without crossing account or role boundaries", () => {
  const { community, sqlite } = fixture();
  community.saveSettingsSection(72, "guestbook", {
    guestbook_css: ".gb-entry{color:blue}",
    guestbook_html: "<footer>saved</footer>",
    is_admin: 1,
  });
  const owner = community.guestbook("sam").owner;
  expect(owner.guestbook_css).toBe(".gb-entry{color:blue}");
  expect(owner.guestbook_html).toBe("<footer>saved</footer>");
  expect(community.member(72).is_admin).toBe(0);
  sqlite
    .prepare("UPDATE users SET updated_at='2000-01-01 00:00:00' WHERE id=72")
    .run();
  community.saveSettingsSection(72, "notifications", {
    notifications_enabled: "on",
  });
  const preferences = community.profile("sam");
  expect(preferences.notifications_enabled).toBe(1);
  expect(preferences.watch_all_threads).toBe(0);
  expect(preferences.updated_at).toBe("2000-01-01 00:00:00");
  community.saveSettingsSection(72, "status", {
    status_emoji: "🌍".repeat(11),
    status_text: "x".repeat(141),
  });
  expect(community.profile("sam").status_emoji).toBe("🌍".repeat(10));
  community.setDisabled(41, 72, true);
  expect(() =>
    community.saveSettingsSection(72, "css", { custom_css: "body{}" }),
  ).toThrow("Membership is unavailable");
});
it("canonical page editing preserves IDs through slug changes and rejects duplicate creation", () => {
  const { community } = fixture();
  const original = community.createSettingsPage(41, "before.html", {
    title: "Before",
    content: "Original",
    content_format: "html",
  });
  expect(() =>
    community.createSettingsPage(41, "before.html", {
      title: "Overwrite",
      content: "wrong",
    }),
  ).toThrow("already exists");
  const edited = community.editSettingsPage(41, "before.html", {
    new_slug: "after.html",
    title: "After",
    content: "Updated",
    content_format: "markdown",
    is_public: 0,
  });
  expect(edited.id).toBe(original.id);
  expect(edited.content).toBe("Updated");
  expect(edited.is_public).toBe(0);
  expect(() => community.page(41, "before.html", 41)).toThrow("Not found");
  expect(() =>
    community.editSettingsPage(72, "after.html", {
      new_slug: "stolen",
      title: "No",
    }),
  ).toThrow("Not found");
});

it("archive replay and metadata updates retain local administrator and disabled-member authority", () => {
  const { community, sqlite } = fixture();
  expect(() =>
    community.assertArchiveRestoreAuthority(
      "https://fixture.example",
      "subject-jane",
    ),
  ).not.toThrow();
  expect(() =>
    community.assertArchiveRestoreAuthority(
      "https://fixture.example",
      "subject-sam",
    ),
  ).toThrow("Admin access");
  expect(() =>
    community.assertArchiveRestoreAuthority(
      "https://other.example",
      "subject-jane",
    ),
  ).toThrow("not linked");
  sqlite.prepare("UPDATE users SET is_admin=0 WHERE id=41").run();
  expect(() =>
    community.assertArchiveRestoreAuthority(
      "https://fixture.example",
      "subject-jane",
    ),
  ).toThrow("Admin access");
  sqlite.prepare("UPDATE users SET is_admin=1,is_disabled=1 WHERE id=41").run();
  expect(() =>
    community.assertArchiveRestoreAuthority(
      "https://fixture.example",
      "subject-jane",
    ),
  ).toThrow("unavailable");
  sqlite.close();
});

it("keeps source browser page fields independent of API limits", () => {
  const { community } = fixture();
  const longSlug = "page-" + "x".repeat(90);
  const longTitle = "A title " + "x".repeat(150);
  const created = community.createSettingsPage(41, longSlug, {
    title: longTitle,
    content: "Original",
    content_format: "markdown",
  });
  expect(created.title).toBe(longTitle);
  expect(community.page(41, longSlug, 41).content).toBe("Original");
  expect(() => community.savePage(41, longSlug, { title: "API" })).toThrow();
  expect(() => community.savePage(41, "api", { title: longTitle })).toThrow();
  const edited = community.editSettingsPage(41, longSlug, {
    new_slug: "  renamed.html  ",
    title: "   ",
    content: "Saved",
    content_format: "html",
    is_public: 0,
  });
  expect(edited.id).toBe(created.id);
  expect(edited.title).toBe("");
  expect(edited.slug).toBe("renamed.html");
  expect(community.pages(41, null)).toEqual([]);
  expect(community.page(41, "renamed.html", 41).content).toBe("Saved");
  expect(() =>
    community.editSettingsPage(72, "renamed.html", { title: "Taken" }),
  ).toThrow();
});

it("pages forum threads with source pin and last-reply ordering", () => {
  const { community, sqlite } = fixture();
  for (let i = 1; i <= 27; i++) {
    sqlite
      .prepare(
        "INSERT INTO forum_threads(id,author_id,title,last_reply_at) VALUES(?,41,?,?)",
      )
      .run(i, `Thread ${i}`, `2026-01-${String(i).padStart(2, "0")} 00:00:00`);
  }
  sqlite.prepare("UPDATE forum_threads SET is_pinned=1 WHERE id=1").run();
  const first = community.forumIndex();
  expect(first.total).toBe(27);
  expect(first.total_pages).toBe(2);
  expect(first.threads).toHaveLength(25);
  expect(first.threads.slice(0, 2).map((t) => t.id)).toEqual([1, 27]);
  expect(first.threads[0].author_username).toBe("jane");
  expect(community.forumIndex(2).threads.map((t) => t.id)).toEqual([3, 2]);
  expect(community.forumIndex(0)).toEqual(first);
  expect(community.forumIndex(3).threads).toEqual([]);
});

it("paginates thread posts by source date and preserves quote snapshots and watching", () => {
  const { community, sqlite } = fixture();
  const thread = community.createThread(41, "Discussion", "First", "bbcode");
  const first = community.thread(thread).posts[0];
  expect(community.thread(thread, 1, 41).watching).toBe(true);
  for (let i = 0; i < 51; i++)
    community.reply(72, thread, `Reply ${i}`, "markdown");
  const quoted = community.reply(72, thread, "Quoted reply", "markdown", {
    quoted_post_id: first.id,
    quoted_content: "Original snapshot",
    quoted_author: "jane",
  });
  community.editPost(41, Number(first.id), "Changed after quote", "markdown");
  const last = community.thread(thread, 2, 72);
  expect(last.total_posts).toBe(53);
  expect(last.total_pages).toBe(2);
  expect(last.posts).toHaveLength(3);
  const snapshot = sqlite
    .prepare("SELECT * FROM forum_posts WHERE id=?")
    .get(quoted);
  expect(snapshot?.quoted_content).toBe("Original snapshot");
  expect(snapshot?.quoted_content_format).toBe("bbcode");
  expect(community.toggleThreadWatch(72, thread)).toBe(true);
  expect(community.thread(thread, 1, 72).watching).toBe(true);
  expect(community.toggleThreadWatch(72, thread)).toBe(false);
  community.setDisabled(41, 72, true);
  expect(() => community.toggleThreadWatch(72, thread)).toThrow();
  community.moderate(41, thread, "lock");
  expect(() =>
    community.reply(41, thread, "Admin also blocked", "bbcode"),
  ).toThrow();
});

it("allows only the thread author or local admin to edit and delete threads", () => {
  const { community } = fixture();
  const thread = community.createThread(72, "Member thread", "First", "bbcode");
  community.editThread(72, thread, {
    title: " Edited ",
    custom_css: "p{color:red}",
    custom_html: "<p>Header</p>",
  });
  expect(community.thread(thread).thread.title).toBe("Edited");
  expect(() => community.moderate(72, thread, "pin")).toThrow();
  const adminThread = community.createThread(
    41,
    "Admin thread",
    "First",
    "bbcode",
  );
  expect(() =>
    community.editThread(72, adminThread, { title: "Taken" }),
  ).toThrow();
  expect(() => community.deleteThread(72, adminThread)).toThrow();
  community.deleteThread(72, thread);
  expect(() => community.thread(thread)).toThrow();
});

it("persists thread creation styling without changing post ownership", () => {
  const { community } = fixture();
  const id = community.createThread(72, " Styled ", "First post", "markdown", {
    custom_css: ".forum-post {color:purple}",
    custom_html: "<aside>Thread intro</aside>",
  });
  const detail = community.thread(id, 1, 72);
  expect(detail.thread.title).toBe("Styled");
  expect(detail.thread.custom_css).toBe(".forum-post {color:purple}");
  expect(detail.thread.custom_html).toBe("<aside>Thread intro</aside>");
  expect(detail.posts[0].author_id).toBe(72);
  expect(detail.watching).toBe(true);
});

it("deletes an owned post without inventing thread deletion or last-reply rewrites", () => {
  const { community } = fixture();
  const thread = community.createThread(41, "Discussion", "First", "bbcode");
  const first = community.thread(thread).posts[0];
  community.deletePost(41, Number(first.id));
  expect(community.thread(thread).posts).toEqual([]);
  expect(community.thread(thread).thread.title).toBe("Discussion");
});

it("enforces forum posting pace atomically across threads with source rounding", () => {
  const { community, sqlite } = fixture(true);
  const id = community.createThread(41, "First", "Body", "bbcode");
  expect(() =>
    community.createThread(41, "Too soon", "Body", "bbcode"),
  ).toThrow("please wait before posting again");
  expect(() => community.reply(41, id, "Too soon", "bbcode")).toThrow();
  expect(community.thread(id).total_posts).toBe(1);
  expect(community.forumIndex().total).toBe(1);
  sqlite
    .prepare(
      "UPDATE forum_posts SET created_at=strftime('%Y-%m-%d %H:%M:%f','now','-9.5 seconds') WHERE author_id=41",
    )
    .run();
  community.reply(41, id, "Allowed by source truncation", "bbcode");
  expect(community.thread(id).total_posts).toBe(2);
  community.reply(72, id, "Different member", "bbcode");
  expect(community.thread(id).total_posts).toBe(3);
});
