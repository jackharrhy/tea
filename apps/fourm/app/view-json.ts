import type { Community } from "./data/community.ts";
import { content, postContent } from "./rendering.ts";
function apiDate(value: unknown) {
  return value
    ? String(value)
        .replace(" ", "T")
        .replace(/\.000000$/u, "")
    : null;
}
export function settingsJSON(
  snapshot: ReturnType<Community["settingsSnapshot"]>,
) {
  const { profile, pages, media, tracks, invites } = snapshot;
  const textFields = [
    "username",
    "display_name",
    "content",
    "content_format",
    "layout",
    "custom_css",
    "custom_html",
    "guestbook_css",
    "guestbook_html",
    "counter_css",
    "counter_html",
    "status_emoji",
    "status_text",
    "player_css",
    "player_html",
    "forum_signature",
  ];
  return {
    ...Object.fromEntries(textFields.map((key) => [key, profile[key] ?? ""])),
    in_webring: Boolean(profile.in_webring),
    notifications_enabled: Boolean(profile.notifications_enabled),
    watch_all_threads: Boolean(profile.watch_all_threads),
    invites: invites.map((invite) => ({
      code: invite.code,
      max_uses: invite.max_uses,
      uses_count: invite.uses_count,
      status: invite.status,
      redeemed_by: invite.redeemed_by,
    })),
    pages: pages.map((page) => ({
      slug: page.slug,
      title: page.title,
      is_public: Boolean(page.is_public),
      layout: "default",
      created_at: null,
      updated_at: apiDate(page.updated_at),
    })),
    media_items: media.map((item) => ({
      id: item.id,
      storage_path: item.storage_path,
      mime_type: item.mime_type,
      size_bytes: item.size_bytes,
      alt_text: item.alt_text ?? null,
    })),
    playlist: tracks.map((track) => ({
      id: track.id,
      title: track.title ?? null,
      storage_path: track.storage_path,
      mime_type: track.mime_type ?? "",
    })),
  };
}
export function homeJSON(home: ReturnType<Community["home"]>) {
  return {
    cards: home.cards.map((card) => ({
      ...card,
      rendered_content: content(
        String(card.content ?? ""),
        String(card.content_format),
      ),
    })),
    recent_forum_posts: home.recent.map((post) => ({
      id: post.id,
      thread_id: post.thread_id,
      thread_title: post.thread_title ?? "",
      author_username: post.author_username,
      author_display_name: post.author_display_name ?? "",
      rendered_content: postContent(
        String(post.content),
        String(post.content_format),
      ),
      created_at: apiDate(post.created_at),
    })),
  };
}

export function forumJSON(index: ReturnType<Community["forumIndex"]>) {
  return {
    ...index,
    threads: index.threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      author_username: thread.author_username,
      author_display_name: thread.author_display_name ?? "",
      reply_count: thread.reply_count ?? 0,
      is_pinned: Boolean(thread.is_pinned),
      is_locked: Boolean(thread.is_locked),
      last_reply_at: apiDate(thread.last_reply_at),
      created_at: apiDate(thread.created_at),
    })),
  };
}
