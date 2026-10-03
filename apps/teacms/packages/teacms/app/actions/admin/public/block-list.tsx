import type { Features } from "../../../ui/public/features.ts";
import { on, type Handle } from "remix/component";
import type {
  ContentBlock,
  Media,
  Adornment,
} from "../../../ui/public/content-types.ts";
import { walkBlocks } from "../../../ui/public/block-references.ts";
import { BlockFields } from "./block-fields.tsx";
import type { PreviewLayout } from "./live-preview.tsx";
const labels: Record<string, string> = {
  paragraph: "Text",
  heading: "Heading",
  media: "Image",
  markdown: "Markdown / embed",
  quote: "Quote",
  bulletListItem: "Bullet list",
  numberedListItem: "Numbered list",
  divider: "Divider",
  special: "Riso colors",
  embed: "Recording",
};

export function BlockList(
  handle: Handle<{
    blocks: ContentBlock[];
    media: Media[];
    adornments: Adornment[];
    features: Features;
    epoch: number;
    previewLayout?: PreviewLayout;
    change: () => void;
  }>,
) {
  let dragId = "",
    dropId = "";
  function changed() {
    handle.props.change();
    handle.update();
  }
  function add(type: string) {
    handle.props.blocks.push({
      id: crypto.randomUUID(),
      type,
      props:
        type === "heading"
          ? { level: 2 }
          : type === "markdown"
            ? { body: "" }
            : type === "special"
              ? { type: "riso_colors" }
              : {},
      content: [],
      children: [],
    });
    changed();
  }
  function move(index: number, by: number) {
    const other = index + by;
    if (other < 0 || other >= handle.props.blocks.length) return;
    [handle.props.blocks[index], handle.props.blocks[other]] = [
      handle.props.blocks[other],
      handle.props.blocks[index],
    ];
    changed();
  }

  return () => {
    const { epoch, previewLayout } = handle.props;
    return (
      <>
        {" "}
        <div className="block-list">
          {handle.props.blocks.map((b, index) => (
            <section
              className={"block-card" + (dropId === b.id ? " drop-target" : "")}
              data-block-id={b.id}
              key={b.id + ":" + epoch}
            >
              <button
                type="button"
                className="block-drag"
                aria-label={
                  "Drag " + (labels[b.type] ?? b.type) + " block " + (index + 1)
                }
                title="Drag to move. Use arrow keys for keyboard reordering."
                mix={[
                  on("pointerdown", (e) => {
                    if (e.button !== 0) return;
                    dragId = b.id;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    e.preventDefault();
                  }),
                  on("pointermove", (e) => {
                    if (dragId !== b.id) return;
                    const target = document
                      .elementFromPoint(e.clientX, e.clientY)
                      ?.closest("[data-block-id]");
                    dropId = target?.getAttribute("data-block-id") ?? "";
                    handle.update();
                    if (e.clientY > window.innerHeight - 70)
                      e.currentTarget
                        .closest(".editor-scroll")
                        ?.scrollBy(0, 18);
                    if (e.clientY < 100)
                      e.currentTarget
                        .closest(".editor-scroll")
                        ?.scrollBy(0, -18);
                  }),
                  on("pointerup", () => {
                    if (!dragId) return;
                    const from = handle.props.blocks.findIndex(
                        (x) => x.id === dragId,
                      ),
                      to = handle.props.blocks.findIndex(
                        (x) => x.id === dropId,
                      );
                    if (from >= 0 && to >= 0 && from !== to) {
                      const [item] = handle.props.blocks.splice(from, 1);
                      handle.props.blocks.splice(to, 0, item);
                      changed();
                    }
                    dragId = dropId = "";
                    handle.update();
                  }),
                  on("pointercancel", () => {
                    dragId = dropId = "";
                    handle.update();
                  }),
                  on("keydown", (e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      e.preventDefault();
                      move(index, e.key === "ArrowUp" ? -1 : 1);
                    }
                  }),
                ]}
              >
                ⠿
              </button>
              <div className="block-top">
                <span>
                  <span className="block-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {labels[b.type] ?? b.type}
                </span>
                <div className="block-actions">
                  <button
                    type="button"
                    title="Move block up"
                    aria-label="Move block up"
                    disabled={index === 0}
                    mix={on("click", () => move(index, -1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="Move block down"
                    aria-label="Move block down"
                    disabled={index === handle.props.blocks.length - 1}
                    mix={on("click", () => move(index, 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    title="Duplicate block"
                    mix={on("click", () => {
                      const copy = structuredClone(b);
                      for (const block of walkBlocks([copy]))
                        block.id = crypto.randomUUID();
                      handle.props.blocks.splice(index + 1, 0, copy);
                      changed();
                    })}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    title="Remove block"
                    mix={on("click", () => {
                      handle.props.blocks.splice(index, 1);
                      changed();
                    })}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <BlockFields
                features={handle.props.features}
                block={b}
                media={handle.props.media}
                adornments={handle.props.adornments}
                change={changed}
                epoch={epoch}
                previewLayout={previewLayout}
              />
              {!!b.children?.length && (
                <details>
                  <summary>{b.children.length} nested blocks</summary>
                  {b.children.map((child) => (
                    <BlockFields
                      features={handle.props.features}
                      key={child.id + ":" + epoch}
                      block={child}
                      media={handle.props.media}
                      adornments={handle.props.adornments}
                      change={changed}
                      epoch={epoch}
                      previewLayout={previewLayout}
                    />
                  ))}
                </details>
              )}
            </section>
          ))}
        </div>
        <div className="add-block">
          <span className="eyebrow">Add block</span>
          <div>
            {Object.entries(labels)
              .filter(
                ([type]) => type !== "special" || handle.props.features.riso,
              )
              .map(([type, label]) => (
                <button
                  type="button"
                  className="button small"
                  mix={on("click", () => add(type))}
                >
                  + {label}
                </button>
              ))}
          </div>
        </div>
      </>
    );
  };
}
