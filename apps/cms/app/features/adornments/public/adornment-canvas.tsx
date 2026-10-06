import {
  imageStyle,
  imageGroupStyle,
  decoratedPhotoStyle,
  adornmentStyle,
  domStyle,
  localPointerDelta,
  type ImageLayout,
} from "../../../ui/public/image-layout.ts";
import { on, ref, type Handle } from "remix/component";

export type Placement = Record<string, string | number>;
export interface CanvasLayer {
  id: string;
  name: string;
  media_id: string | null;
  css: Placement;
}
function placementStyle(
  p: Placement,
): Record<string, string | number | undefined> {
  return domStyle(adornmentStyle(p));
}
export function AdornmentCanvas(
  handle: Handle<{
    image: string | null;
    imageProps?: ImageLayout;
    previewLayout?: { width: number; fontSize: number };
    layers: CanvasLayer[];
    selected?: string;
    select?: (id: string) => void;
    change?: (id: string, css: Placement) => void;
  }>,
) {
  let stage: HTMLDivElement;
  let availableWidth = 350,
    sceneHeight = 260;
  function baseWidth() {
    return handle.props.previewLayout?.width || availableWidth;
  }
  function scale() {
    return Math.min(1, availableWidth / baseWidth());
  }
  let drag: {
    id: string;
    x: number;
    y: number;
    left: number;
    top: number;
    scale: number;
    angle: number;
  } | null = null;
  function change(id: string, css: Placement) {
    handle.props.change?.(id, css);
    handle.update();
  }
  function measuredSize(id: string) {
    const element =
      stage &&
      [...stage.querySelectorAll<HTMLImageElement>("[data-layer-id]")].find(
        (node) => node.dataset.layerId === id,
      );
    return element && stage.clientWidth
      ? Math.round((element.offsetWidth / stage.clientWidth) * 100)
      : 30;
  }
  function move(id: string, left: number, top: number) {
    const layer = handle.props.layers.find((l) => l.id === id)!;
    change(id, {
      ...layer.css,
      left: Math.max(-100, Math.min(200, left)).toFixed(2) + "%",
      top: Math.max(-100, Math.min(200, top)).toFixed(2) + "%",
      right: "",
      bottom: "",
    });
  }
  return () => {
    const selected = handle.props.layers.find(
      (l) => l.id === handle.props.selected,
    );
    const p = handle.props.imageProps ?? {},
      decorated = handle.props.layers.some((l) => l.media_id);
    return (
      <div className="adornment-workbench">
        <div
          className="composition-surround"
          mix={ref((node, signal) => {
            const observer = new ResizeObserver((entries) => {
              const width = entries[0].contentRect.width;
              if (width > 0 && width !== availableWidth) {
                availableWidth = width;
                handle.update();
              }
            });
            observer.observe(node);
            signal.addEventListener("abort", () => observer.disconnect());
          })}
        >
          <div
            className="composition-viewport"
            style={{
              width: baseWidth() * scale(),
              height: sceneHeight * scale(),
            }}
          >
            <div
              className="composition-scene"
              style={{
                width: baseWidth(),
                fontSize: handle.props.previewLayout?.fontSize ?? 16,
                transform: `scale(${scale()})`,
              }}
              mix={ref((node, signal) => {
                const observer = new ResizeObserver(() => {
                  if (node.offsetHeight !== sceneHeight) {
                    sceneHeight = node.offsetHeight;
                    handle.update();
                  }
                });
                observer.observe(node);
                signal.addEventListener("abort", () => observer.disconnect());
              })}
            >
              <div
                className="composition"
                style={
                  decorated
                    ? domStyle(imageGroupStyle(p))
                    : { display: "contents" }
                }
                mix={ref((node) => {
                  stage = node;
                })}
              >
                {handle.props.image ? (
                  <img
                    className="composition-photo"
                    style={domStyle(
                      decorated ? decoratedPhotoStyle(p) : imageStyle(p),
                    )}
                    src={"/tea/api/media/file/" + handle.props.image}
                    alt="Image with adornments"
                    draggable={false}
                  />
                ) : (
                  <div className="composition-placeholder">
                    Choose a preview image
                  </div>
                )}
                {handle.props.layers
                  .filter((l) => l.media_id)
                  .map((layer) => (
                    <img
                      key={layer.id}
                      className={
                        "composition-layer" +
                        (selected?.id === layer.id ? " selected" : "")
                      }
                      data-layer-id={layer.id}
                      src={"/tea/api/media/file/" + layer.media_id}
                      alt={layer.name}
                      role={handle.props.change ? "button" : undefined}
                      tabIndex={handle.props.change ? 0 : undefined}
                      aria-label={
                        handle.props.change ? "Move " + layer.name : undefined
                      }
                      draggable={false}
                      style={placementStyle(layer.css)}
                      mix={[
                        on("load", () => {
                          handle.update();
                        }),
                        on("pointerdown", (e) => {
                          if (!handle.props.change || e.button !== 0) return;
                          e.preventDefault();
                          handle.props.select?.(layer.id);
                          drag = {
                            id: layer.id,
                            x: e.clientX,
                            y: e.clientY,
                            left: e.currentTarget.offsetLeft,
                            top: e.currentTarget.offsetTop,
                            scale: scale(),
                            angle: Number(p.rotation) || 0,
                          };
                          e.currentTarget.setPointerCapture(e.pointerId);
                          handle.update();
                        }),
                        on("pointermove", (e) => {
                          if (drag?.id !== layer.id) return;
                          const delta = localPointerDelta(
                            e.clientX - drag.x,
                            e.clientY - drag.y,
                            drag.angle,
                            drag.scale,
                          );
                          move(
                            layer.id,
                            ((drag.left + delta.x) / stage.clientWidth) * 100,
                            ((drag.top + delta.y) / stage.clientHeight) * 100,
                          );
                        }),
                        on("pointerup", () => {
                          drag = null;
                        }),
                        on("pointercancel", () => {
                          drag = null;
                        }),
                        on("keydown", (e) => {
                          if (!handle.props.change) return;
                          const direction = {
                            ArrowLeft: [-1, 0],
                            ArrowRight: [1, 0],
                            ArrowUp: [0, -1],
                            ArrowDown: [0, 1],
                          }[e.key];
                          if (direction) {
                            e.preventDefault();
                            handle.props.select?.(layer.id);
                            move(
                              layer.id,
                              (e.currentTarget.offsetLeft / stage.clientWidth) *
                                100 +
                                direction[0] * (e.shiftKey ? 5 : 1),
                              (e.currentTarget.offsetTop / stage.clientHeight) *
                                100 +
                                direction[1] * (e.shiftKey ? 5 : 1),
                            );
                          }
                        }),
                      ]}
                    />
                  ))}
              </div>
            </div>
          </div>
        </div>
        {selected && handle.props.change && (
          <div className="placement-controls">
            <label>
              Size
              <input
                type="range"
                min={5}
                max={150}
                value={
                  String(selected.css.width ?? "").endsWith("%")
                    ? parseFloat(String(selected.css.width))
                    : measuredSize(selected.id)
                }
                mix={on("input", (e) =>
                  change(selected.id, {
                    ...selected.css,
                    width: e.currentTarget.value + "%",
                    height: "",
                  }),
                )}
              />
            </label>
            <label>
              Angle <span>{Number(selected.css.rotation) || 0}°</span>
              <input
                type="range"
                aria-label="Angle"
                min={-180}
                max={180}
                value={Number(selected.css.rotation) || 0}
                mix={on("input", (e) =>
                  change(selected.id, {
                    ...selected.css,
                    rotation: Number(e.currentTarget.value),
                  }),
                )}
              />
            </label>
            <button
              type="button"
              className="button small"
              mix={on("click", () =>
                change(selected.id, {
                  ...selected.css,
                  width: "30%",
                  height: "",
                  left: "35%",
                  top: "0%",
                  right: "",
                  bottom: "",
                  rotation: 0,
                }),
              )}
            >
              Center at top
            </button>
            <small>
              Drag the artwork to position it. Arrow keys nudge; Shift moves
              farther.
            </small>
          </div>
        )}
      </div>
    );
  };
}
