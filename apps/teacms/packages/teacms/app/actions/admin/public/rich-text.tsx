import { on, ref, unsafeHTML, type Handle } from "remix/component";
import { Editor, Mark } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Inline } from "../../../ui/public/content-types.ts";
import { textDocument, inlineDocument } from "./text-document.ts";

// Keep imported colors and future style metadata in the existing block format.
const LegacyStyle = Mark.create({
  name: "legacyStyle",
  addAttributes() {
    return { value: { default: {}, rendered: false } };
  },
  renderHTML({ mark }) {
    const value = mark.attrs.value ?? {};
    return [
      "span",
      {
        style: [
          value.textColor && value.textColor !== "default"
            ? "color:" + value.textColor
            : "",
          value.backgroundColor && value.backgroundColor !== "default"
            ? "background-color:" + value.backgroundColor
            : "",
        ]
          .filter(Boolean)
          .join(";"),
      },
      0,
    ];
  },
});
export function RichText(
  handle: Handle<{
    content: Inline[];
    label: string;
    change: (value: Inline[]) => void;
  }>,
) {
  let editor: Editor | undefined,
    linkOpen = false,
    link = "",
    selection = { from: 0, to: 0 };
  function format(name: string) {
    if (!editor) return;
    if (name === "clear") editor.chain().focus().unsetAllMarks().run();
    else editor.chain().focus().toggleMark(name).run();
  }
  return () => (
    <div className="rich-text-wrap">
      <div className="rich-toolbar" aria-label="Text formatting">
        {[
          ["bold", "Bold", "B"],
          ["italic", "Italic", "I"],
          ["underline", "Underline", "U"],
          ["strike", "Strikethrough", "S"],
        ].map(([name, label, text]) => (
          <button
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={editor?.isActive(name) ?? false}
            mix={[
              on("mousedown", (e) => e.preventDefault()),
              on("click", () => format(name)),
            ]}
          >
            <span className={name}>{text}</span>
          </button>
        ))}
        <button
          type="button"
          mix={[
            on("mousedown", (e) => e.preventDefault()),
            on("click", () => {
              if (!editor) return;
              selection = {
                from: editor.state.selection.from,
                to: editor.state.selection.to,
              };
              link = editor.getAttributes("link").href ?? "";
              linkOpen = !linkOpen;
              handle.update();
            }),
          ]}
        >
          Link
        </button>
        <button
          type="button"
          title="Remove formatting"
          mix={[
            on("mousedown", (e) => e.preventDefault()),
            on("click", () => format("clear")),
          ]}
        >
          Clear
        </button>
        {linkOpen && (
          <span className="inline-link-form">
            <input
              type="url"
              aria-label="Link URL"
              placeholder="https://…"
              value={link}
              mix={on("input", (e) => {
                link = e.currentTarget.value;
                handle.update();
              })}
            />
            <button
              type="button"
              mix={on("click", () => {
                if (/^(https?:\/\/|mailto:|\/[^/]|#)/.test(link)) {
                  editor
                    ?.chain()
                    .focus()
                    .setTextSelection(selection)
                    .setLink({ href: link })
                    .run();
                  linkOpen = false;
                  handle.update();
                }
              })}
            >
              Apply
            </button>
            <button
              type="button"
              mix={on("click", () => {
                editor
                  ?.chain()
                  .focus()
                  .setTextSelection(selection)
                  .unsetLink()
                  .run();
                linkOpen = false;
                handle.update();
              })}
            >
              Unlink
            </button>
          </span>
        )}
      </div>
      {/* A stable innerHTML marks this leaf as opaque to Remix; TipTap owns its DOM. */}
      <div
        className="tiptap-host"
        innerHTML={unsafeHTML("")}
        mix={ref((element, signal) => {
          editor = new Editor({
            element,
            injectCSS: false,
            extensions: [
              StarterKit.configure({
                heading: false,
                blockquote: false,
                bulletList: false,
                orderedList: false,
                listItem: false,
                listKeymap: false,
                codeBlock: false,
                horizontalRule: false,
                trailingNode: false,
                link: { openOnClick: false },
              }),
              LegacyStyle,
            ],
            content: textDocument(handle.props.content),
            editorProps: {
              attributes: {
                class: "rich-text tiptap",
                role: "textbox",
                "aria-label": handle.props.label,
                "aria-multiline": "true",
              },
            },
            onUpdate: ({ editor: updatedEditor }) =>
              handle.props.change(inlineDocument(updatedEditor.getJSON())),
            onTransaction: () => {
              handle.update();
            },
          });
          signal.addEventListener("abort", () => editor?.destroy());
        })}
      />
    </div>
  );
}
