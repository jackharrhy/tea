import { Editor, type JSONContent } from "@tiptap/core";
import Blockquote from "@tiptap/extension-blockquote";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Image from "@tiptap/extension-image";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import { BulletList, ListItem, ListKeymap } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import Text from "@tiptap/extension-text";
import { Dropcursor, Gapcursor, UndoRedo } from "@tiptap/extensions";
import {
  clientEntry,
  ref,
  type Handle,
  type SerializableProps,
} from "remix/component";

const MAX_CHARACTERS = 5000;
const MAX_IMAGES = 10;
const LocalImage = Image.extend({
  addInputRules() {
    return [];
  },
  parseHTML() {
    return [{ tag: 'img[src^="/uploads/"]' }];
  },
});

interface RichLetterEditorProps extends SerializableProps {
  allowImages?: boolean;
  autoFocus?: boolean;
  body: string;
  bodyJson?: string;
  describedBy?: string;
  draftToken?: string;
  draftTokenFieldName?: string;
  fieldName: string;
  fontFieldName?: string;
  fontKey?: "handwritten" | "book" | "plain";
  id: string;
  invalid?: boolean;
  jsonFieldName: string;
  label: string;
  required?: boolean;
  showFontPicker?: boolean;
  uploadUrl?: string;
}

interface UploadResponse {
  error?: string;
  height?: number;
  id?: string;
  src?: string;
  width?: number;
}

export const RichLetterEditor = clientEntry(
  import.meta.url,
  function RichLetterEditor(handle: Handle<RichLetterEditorProps>) {
    return () => {
      let props = handle.props;
      return (
        <div
          className="rich-editor"
          data-font={props.fontKey ?? "handwritten"}
          mix={ref((root, signal) => enhanceEditor(root, props, signal))}
        >
          <div
            className="editor-toolbar"
            role="toolbar"
            aria-label={`${props.label} formatting`}
          >
            <div className="editor-tools">
              <button
                type="button"
                data-command="bold"
                aria-label="Bold"
                title="Bold"
              >
                <strong>B</strong>
              </button>
              <button
                type="button"
                data-command="italic"
                aria-label="Italic"
                title="Italic"
              >
                <em>I</em>
              </button>
              <button
                type="button"
                data-command="link"
                aria-label="Add link"
                title="Add link"
              >
                link
              </button>
              <button
                type="button"
                data-command="blockquote"
                aria-label="Quote"
                title="Quote"
              >
                quote
              </button>
              <button
                type="button"
                data-command="bulletList"
                aria-label="Bulleted list"
                title="Bulleted list"
              >
                list
              </button>
              {props.allowImages ? (
                <button
                  type="button"
                  data-command="image"
                  aria-label="Add image"
                  title="Add image"
                >
                  image
                </button>
              ) : null}
            </div>
            <div className="editor-tools editor-history">
              <button
                type="button"
                data-command="undo"
                aria-label="Undo"
                title="Undo"
              >
                undo
              </button>
              <button
                type="button"
                data-command="redo"
                aria-label="Redo"
                title="Redo"
              >
                redo
              </button>
            </div>
          </div>

          <div className="editor-writing-surface">
            <textarea
              id={props.id}
              className="letter-textarea editor-fallback"
              name={props.fieldName}
              rows={18}
              maxLength={MAX_CHARACTERS}
              required={props.required}
              autoFocus={props.autoFocus}
              aria-invalid={props.invalid}
              aria-describedby={props.describedBy}
              placeholder="Write your letter here..."
              defaultValue={props.body}
            />
            <div className="tiptap-mount" />
          </div>

          <input type="hidden" value={props.bodyJson ?? ""} data-editor-json />
          {props.draftToken && props.draftTokenFieldName ? (
            <input
              type="hidden"
              name={props.draftTokenFieldName}
              value={props.draftToken}
            />
          ) : null}
          {props.allowImages ? (
            <input
              className="editor-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              data-editor-file
              tabIndex={-1}
            />
          ) : null}

          <div className="editor-lower-row">
            {props.showFontPicker && props.fontFieldName ? (
              <label className="font-picker">
                <span>writing style</span>
                <select name={props.fontFieldName}>
                  <option
                    value="handwritten"
                    selected={
                      (props.fontKey ?? "handwritten") === "handwritten"
                    }
                  >
                    handwritten
                  </option>
                  <option value="book" selected={props.fontKey === "book"}>
                    book
                  </option>
                  <option value="plain" selected={props.fontKey === "plain"}>
                    plain
                  </option>
                </select>
              </label>
            ) : (
              <span />
            )}
            <span className="editor-count" aria-live="polite">
              {props.body.length} / {MAX_CHARACTERS}
            </span>
          </div>
          <p className="editor-status" role="status" aria-live="polite" />
        </div>
      );
    };
  },
);

function enhanceEditor(
  root: HTMLElement,
  props: RichLetterEditorProps,
  signal: AbortSignal,
) {
  let textarea = root.querySelector<HTMLTextAreaElement>(".editor-fallback");
  let mount = root.querySelector<HTMLElement>(".tiptap-mount");
  let jsonInput = root.querySelector<HTMLInputElement>("[data-editor-json]");
  let fileInput = root.querySelector<HTMLInputElement>("[data-editor-file]");
  let status = root.querySelector<HTMLElement>(".editor-status");
  let count = root.querySelector<HTMLElement>(".editor-count");
  let form = root.closest("form");
  if (!textarea || !mount || !jsonInput || !status || !count || !form) return;

  let uploadsInFlight = 0;
  let editor = new Editor({
    element: mount,
    extensions: [
      Blockquote,
      Bold,
      BulletList,
      Document,
      Dropcursor,
      Gapcursor,
      HardBreak,
      Italic,
      Link.configure({
        autolink: true,
        defaultProtocol: "https",
        linkOnPaste: true,
        openOnClick: false,
      }),
      ListItem,
      ListKeymap,
      Paragraph,
      Text,
      UndoRedo,
      LocalImage.configure({
        allowBase64: false,
        HTMLAttributes: { class: "letter-image" },
        resize: false,
      }),
      Placeholder.configure({ placeholder: "Write your letter here..." }),
    ],
    content: readInitialContent(props.bodyJson, props.body),
    autofocus: props.autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        "aria-label": props.label,
        class: "tiptap",
      },
      handleDrop(_view, event) {
        let file = firstImage(event.dataTransfer?.files);
        if (!file || !props.allowImages) return false;
        event.preventDefault();
        void uploadImage(file);
        return true;
      },
      handlePaste(_view, event) {
        let file = firstImage(event.clipboardData?.files);
        if (!file || !props.allowImages) return false;
        event.preventDefault();
        void uploadImage(file);
        return true;
      },
    },
    onCreate() {
      textarea!.required = false;
      jsonInput!.name = props.jsonFieldName;
      root.classList.add("is-enhanced");
      syncFields();
      syncToolbar();
    },
    onSelectionUpdate() {
      syncToolbar();
    },
    onTransaction() {
      syncToolbar();
    },
    onUpdate() {
      syncFields();
    },
  });

  for (let button of root.querySelectorAll<HTMLButtonElement>(
    "[data-command]",
  )) {
    button.addEventListener(
      "click",
      () => {
        let command = button.dataset.command;
        if (command === "bold") editor.chain().focus().toggleBold().run();
        if (command === "italic") editor.chain().focus().toggleItalic().run();
        if (command === "blockquote")
          editor.chain().focus().toggleBlockquote().run();
        if (command === "bulletList")
          editor.chain().focus().toggleBulletList().run();
        if (command === "undo") editor.chain().focus().undo().run();
        if (command === "redo") editor.chain().focus().redo().run();
        if (command === "image") fileInput?.click();
        if (command === "link") editLink();
      },
      { signal },
    );
  }

  fileInput?.addEventListener(
    "change",
    () => {
      let file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) void uploadImage(file);
    },
    { signal },
  );

  root.querySelector<HTMLSelectElement>("select")?.addEventListener(
    "change",
    (event) => {
      root.dataset.font = (event.currentTarget as HTMLSelectElement).value;
    },
    { signal },
  );

  form.addEventListener(
    "submit",
    (event) => {
      syncFields();
      let length = editor.getText({ blockSeparator: "\n" }).trim().length;
      if (uploadsInFlight > 0) {
        event.preventDefault();
        setStatus("Wait for the image to finish uploading.", true);
      } else if (props.required && length === 0) {
        event.preventDefault();
        setStatus("This field cannot be empty.", true);
        editor.commands.focus();
      } else if (length > MAX_CHARACTERS) {
        event.preventDefault();
        setStatus(
          `Shorten this letter by ${length - MAX_CHARACTERS} characters.`,
          true,
        );
      }
    },
    { signal },
  );

  signal.addEventListener("abort", () => editor.destroy(), { once: true });

  function syncFields() {
    let text = editor.getText({ blockSeparator: "\n" }).trim();
    textarea!.value = text;
    jsonInput!.value = JSON.stringify(editor.getJSON());
    count!.textContent = `${text.length} / ${MAX_CHARACTERS}`;
    count!.classList.toggle("is-over-limit", text.length > MAX_CHARACTERS);
  }

  function syncToolbar() {
    setPressed("bold", editor.isActive("bold"));
    setPressed("italic", editor.isActive("italic"));
    setPressed("blockquote", editor.isActive("blockquote"));
    setPressed("bulletList", editor.isActive("bulletList"));
    setDisabled("undo", !editor.can().undo());
    setDisabled("redo", !editor.can().redo());
  }

  function setPressed(command: string, pressed: boolean) {
    root
      .querySelector<HTMLButtonElement>(`[data-command="${command}"]`)
      ?.setAttribute("aria-pressed", String(pressed));
  }

  function setDisabled(command: string, disabled: boolean) {
    let button = root.querySelector<HTMLButtonElement>(
      `[data-command="${command}"]`,
    );
    if (button) button.disabled = disabled;
  }

  function editLink() {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    let href = window.prompt("Link address")?.trim();
    if (!href) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) href = `https://${href}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  async function uploadImage(file: File) {
    if (!props.uploadUrl || !props.draftToken) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setStatus("Choose a JPEG, PNG, or WebP image.", true);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setStatus("Each image must be 10 MB or smaller.", true);
      return;
    }
    if (imageCount(editor.getJSON()) >= MAX_IMAGES) {
      setStatus(`A letter can contain up to ${MAX_IMAGES} images.`, true);
      return;
    }

    let suggestedAlt = file.name
      .replace(/\.[^.]+$/, "")
      .replaceAll(/[-_]+/g, " ");
    let alt = window.prompt(
      "Briefly describe this image for people who cannot see it.",
      suggestedAlt,
    );
    if (alt === null) return;

    uploadsInFlight++;
    setUploadState(true);
    setStatus("Preparing image...", false);
    try {
      let formData = new FormData();
      formData.set("image", file);
      let response = await fetch(props.uploadUrl, {
        body: formData,
        headers: { "X-Draft-Token": props.draftToken },
        method: "POST",
        signal,
      });
      let result = (await response.json().catch(() => ({}))) as UploadResponse;
      if (!response.ok || !result.src || !result.width || !result.height) {
        throw new Error(result.error || "The image could not be uploaded.");
      }
      editor
        .chain()
        .focus()
        .setImage({
          alt: alt.trim().slice(0, 240),
          height: result.height,
          src: result.src,
          width: result.width,
        })
        .run();
      setStatus("Image added.", false);
    } catch (error) {
      if (signal.aborted) return;
      setStatus(
        error instanceof Error
          ? error.message
          : "The image could not be uploaded.",
        true,
      );
    } finally {
      uploadsInFlight--;
      setUploadState(uploadsInFlight > 0);
    }
  }

  function setUploadState(uploading: boolean) {
    root.classList.toggle("is-uploading", uploading);
    for (let button of form!.querySelectorAll<HTMLButtonElement>(
      'button[type="submit"]',
    )) {
      button.disabled = uploading;
    }
    let imageButton = root.querySelector<HTMLButtonElement>(
      '[data-command="image"]',
    );
    if (imageButton) imageButton.disabled = uploading;
  }

  function setStatus(message: string, isError: boolean) {
    status!.textContent = message;
    status!.classList.toggle("is-error", isError);
  }
}

function readInitialContent(
  json: string | undefined,
  fallback: string,
): JSONContent {
  if (json) {
    try {
      return JSON.parse(json) as JSONContent;
    } catch {
      // Use the plain-text fallback below.
    }
  }

  return {
    type: "doc",
    content: fallback
      .replaceAll("\r\n", "\n")
      .split("\n")
      .map((line) => ({
        type: "paragraph",
        content: line ? [{ type: "text", text: line }] : [],
      })),
  };
}

function firstImage(files: FileList | undefined): File | null {
  if (!files) return null;
  return [...files].find((file) => file.type.startsWith("image/")) ?? null;
}

function imageCount(document: JSONContent): number {
  let count = document.type === "image" ? 1 : 0;
  for (let child of document.content ?? []) count += imageCount(child);
  return count;
}
