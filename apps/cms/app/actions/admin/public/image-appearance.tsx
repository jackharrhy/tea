import { on, type Handle } from "remix/component";
import type { ImageLayout } from "../../../ui/public/image-layout.ts";

export function ImageAppearance(
  handle: Handle<{
    value: ImageLayout;
    change: (changes: ImageLayout) => void;
  }>,
) {
  let colorSource = "",
    colorHex = "#6b5b4d";
  function border(style?: string, width?: string, color?: string) {
    const current = parseBorder(String(handle.props.value.border ?? ""));
    const nextStyle = style ?? current.style;
    handle.props.change({
      border:
        nextStyle === "none"
          ? "none"
          : `${width ?? current.width} ${nextStyle} ${color ?? current.color}`,
    });
  }
  return () => {
    const p = handle.props.value,
      current = parseBorder(String(p.border ?? ""));
    if (colorSource !== current.color) {
      handle.queueTask(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.fillStyle = current.color;
        context.fillRect(0, 0, 1, 1);
        colorSource = current.color;
        colorHex =
          "#" +
          [...context.getImageData(0, 0, 1, 1).data]
            .slice(0, 3)
            .map((channel) => channel.toString(16).padStart(2, "0"))
            .join("");
        handle.update();
      });
    }
    return (
      <div className="image-appearance">
        <label>
          Image tilt <span className="muted">{Number(p.rotation) || 0}°</span>
          <input
            type="range"
            aria-label="Image tilt"
            min={-180}
            max={180}
            value={Number(p.rotation) || 0}
            mix={on("input", (e) =>
              handle.props.change({ rotation: e.currentTarget.value }),
            )}
          />
        </label>
        <label>
          Image border
          <select
            aria-label="Image border"
            value={current.style}
            mix={on<HTMLSelectElement>("change", (e) =>
              border(e.currentTarget.value),
            )}
          >
            {[
              "none",
              "solid",
              "dashed",
              "dotted",
              "double",
              ...(current.style === "custom" ? ["custom"] : []),
            ].map((style) => (
              <option value={style} selected={style === current.style}>
                {style === "custom"
                  ? "Custom (see advanced)"
                  : style[0].toUpperCase() + style.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Border width <span className="muted">{current.width}</span>
          <input
            type="range"
            aria-label="Border width"
            min={0}
            max={12}
            value={parseFloat(current.width)}
            disabled={["none", "custom"].includes(current.style)}
            mix={on("input", (e) =>
              border(undefined, e.currentTarget.value + "px"),
            )}
          />
        </label>
        <label>
          Border color
          <input
            type="color"
            aria-label="Border color"
            value={
              /^#[\da-f]{6}$/i.test(current.color) ? current.color : colorHex
            }
            disabled={["none", "custom"].includes(current.style)}
            mix={on("input", (e) =>
              border(undefined, undefined, e.currentTarget.value),
            )}
          />
        </label>
      </div>
    );
  };
}
function parseBorder(value: string) {
  if (!value || value === "none" || value === "0")
    return { style: "none", width: "2px", color: "#6b5b4d" };
  const match = value.match(
    /^(\d*\.?\d+(?:px|rem|em))\s+(solid|dashed|dotted|double)\s+(.+)$/i,
  );
  return match
    ? { width: match[1], style: match[2], color: match[3] }
    : { style: "custom", width: "2px", color: "#6b5b4d" };
}
