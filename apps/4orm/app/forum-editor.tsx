import type { Handle } from "remix/component";
import type { Row } from "./data/community.ts";
import { MediaPicker } from "./settings-view.tsx";
export function ForumEditor(handle: Handle<{ media: Row[]; post?: Row }>) {
  return () => {
    const { media, post } = handle.props;
    const editor = post ? "edit-post-content" : "thread-content";
    return (
      <>
        <h1>{post ? "edit post" : "new thread"}</h1>
        <form
          method="post"
          action={post ? `/forum/posts/${post.id}/edit` : "/forum/new"}
          class="stack"
        >
          {!post ? (
            <label>
              title
              <input
                type="text"
                name="title"
                required
                maxLength={200}
                placeholder="thread title"
              />
            </label>
          ) : null}
          <label>
            format (
            <a
              href="https://www.phpbb.com/community/help/bbcode"
              target="_blank"
            >
              BBCode?
            </a>
            ):
            <select name="content_format">
              <option
                value="bbcode"
                selected={!post || post.content_format === "bbcode"}
              >
                BBCode
              </option>
              <option
                value="markdown"
                selected={post?.content_format === "markdown"}
              >
                Markdown
              </option>
            </select>
          </label>
          <label>
            content
            <textarea
              name="content"
              id={editor}
              rows={10}
              required
              placeholder={post ? undefined : "write your post..."}
              value={String(post?.content ?? "")}
            />
          </label>
          <MediaPicker items={media} editor={editor} format="bbcode" />
          {!post ? (
            <details class="panel">
              <summary>
                <h2>thread styling</h2>
              </summary>
              <div class="stack fourm-space-sm">
                <label>
                  custom CSS
                  <textarea
                    name="custom_css"
                    rows={4}
                    placeholder="CSS applied to this thread"
                  />
                </label>
                <label>
                  custom HTML
                  <textarea
                    name="custom_html"
                    rows={4}
                    placeholder="HTML injected into this thread"
                  />
                </label>
              </div>
            </details>
          ) : null}
          <div class="fourm-actions fourm-space-xs">
            <button type="submit">{post ? "save" : "create thread"}</button>
            <button type="button" class="btn-sm" data-preview-editor={editor}>
              preview
            </button>
          </div>
          <div
            id={`preview-${editor}`}
            class="forum-preview fourm-hidden"
            data-state="idle"
          ></div>
        </form>
        {post ? (
          <p class="fourm-space-sm">
            <a href={`/forum/${post.thread_id}`}>back to thread</a>
          </p>
        ) : null}
      </>
    );
  };
}
