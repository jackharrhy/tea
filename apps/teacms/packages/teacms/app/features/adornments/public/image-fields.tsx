import { on, type Handle } from "remix/component";
import type {
  ContentBlock,
  Media,
  Adornment,
} from "../../../ui/public/content-types.ts";
import {
  parseAdornmentInstances,
  type AdornmentInstance,
} from "./adornment-instances.ts";
import { AdornmentCanvas } from "./adornment-canvas.tsx";
import { ImageAppearance } from "../../../actions/admin/public/image-appearance.tsx";
import { MediaPicker } from "../../../actions/admin/public/media-picker.tsx";

export function ImageFields(
  handle: Handle<{
    block: ContentBlock;
    media: Media[];
    adornments: Adornment[];
    change: () => void;
    previewLayout?: { width: number; fontSize: number };
  }>,
) {
  let picking = false,
    selected = "",
    adding = false;
  function set(key: string, value: unknown) {
    handle.props.block.props[key] = value;
    handle.props.change();
    handle.update();
  }
  function placements(refs: AdornmentInstance[]) {
    set("adornments", JSON.stringify(refs));
  }
  return () => {
    const { block, media, adornments, previewLayout } = handle.props,
      p = block.props;
    const refs = parseAdornmentInstances(p.adornments) ?? [];
    return (
      <div className="image-block">
        <div className="image-block-preview">
          {p.mediaId ? (
            <AdornmentCanvas
              image={p.mediaId}
              imageProps={p}
              previewLayout={previewLayout}
              layers={refs.flatMap((r) => {
                const art = adornments.find((a) => a.name === r.adornmentName);
                return art
                  ? [{ ...art, id: r.id, css: { ...art.css, ...r.css } }]
                  : [];
              })}
              selected={selected}
              select={(id) => {
                selected = id;
                handle.update();
              }}
              change={(id, css) =>
                placements(refs.map((r) => (r.id === id ? { ...r, css } : r)))
              }
            />
          ) : (
            <p className="muted">No image selected.</p>
          )}
          <button
            type="button"
            className="button"
            mix={on("click", () => {
              picking = true;
              handle.update();
            })}
          >
            {p.mediaId ? "Change image" : "Choose image"}
          </button>
        </div>
        <ImageAppearance
          value={p}
          change={(changes) => {
            Object.assign(p, changes);
            handle.props.change();
            handle.update();
          }}
        />
        <label>
          Alternative text
          <input
            value={p.alt ?? ""}
            placeholder="Describe the image"
            mix={on("input", (e) => set("alt", e.currentTarget.value))}
          />
        </label>
        <section className="image-adornments" aria-label="Image adornments">
          <div className="section-heading">
            <span>Adornments{refs.length ? ` · ${refs.length}` : ""}</span>
            <button
              className="button small"
              type="button"
              aria-expanded={adding}
              disabled={refs.length >= 100}
              mix={on("click", () => {
                adding = !adding;
                handle.update();
              })}
            >
              Add adornment
            </button>
          </div>
          {refs.map((r, index) => (
            <div
              className="adornment-instance"
              key={r.id}
              data-instance-id={r.id}
            >
              <button
                className="text-button"
                type="button"
                aria-pressed={selected === r.id}
                mix={on("click", () => {
                  selected = r.id;
                  handle.update();
                })}
              >
                {r.adornmentName} <small>{index + 1}</small>
              </button>
              <button
                className="text-button"
                type="button"
                aria-label={`Duplicate adornment ${index + 1}`}
                disabled={refs.length >= 100}
                mix={on("click", () => {
                  const copy = {
                    ...structuredClone(r),
                    id: crypto.randomUUID(),
                  };
                  selected = copy.id;
                  placements([
                    ...refs.slice(0, index + 1),
                    copy,
                    ...refs.slice(index + 1),
                  ]);
                })}
              >
                Duplicate
              </button>
              <button
                className="text-button"
                type="button"
                aria-label={`Remove adornment ${index + 1}`}
                mix={on("click", () => {
                  if (selected === r.id) selected = "";
                  placements(refs.filter((item) => item.id !== r.id));
                })}
              >
                Remove
              </button>
            </div>
          ))}
          {adding && (
            <div
              className="adornment-choices compact-choices"
              aria-label="Choose adornment"
            >
              {adornments.map((a) => (
                <button
                  type="button"
                  className="button small"
                  mix={on("click", () => {
                    selected = crypto.randomUUID();
                    adding = false;
                    placements([
                      ...refs,
                      { id: selected, adornmentName: a.name },
                    ]);
                  })}
                >
                  {a.media_id && (
                    <img src={"/tea/api/media/file/" + a.media_id} alt="" />
                  )}
                  {a.name}
                </button>
              ))}
            </div>
          )}
        </section>
        <details>
          <summary>Advanced image layout</summary>
          <div className="field-grid">
            {[
              "width",
              "height",
              "rotation",
              "border",
              "padding",
              "margin",
              "filter",
              "top",
              "right",
              "bottom",
              "left",
            ].map((key) => (
              <label>
                {key}
                <input
                  value={p[key] ?? ""}
                  mix={on("input", (e) => set(key, e.currentTarget.value))}
                />
              </label>
            ))}
          </div>
        </details>
        {picking && (
          <MediaPicker
            media={media}
            choose={(m) => {
              p.mediaId = m.id;
              if (!p.alt) p.alt = m.alt ?? "";
              delete p.naturalWidth;
              delete p.naturalHeight;
              const image = new Image();
              image.addEventListener(
                "load",
                () => {
                  if (!handle.signal.aborted && p.mediaId === m.id) {
                    p.naturalWidth = image.naturalWidth;
                    p.naturalHeight = image.naturalHeight;
                    handle.props.change();
                    handle.update();
                  }
                },
                { once: true, signal: handle.signal },
              );
              image.src = "/tea/api/media/file/" + m.id;
              picking = false;
              handle.props.change();
              handle.update();
            }}
            close={() => {
              picking = false;
              handle.update();
            }}
          />
        )}
      </div>
    );
  };
}
