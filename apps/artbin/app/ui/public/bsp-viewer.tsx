import type { WorldSource } from "@jackharrhy/worldview";
import type { BspFormat } from "@jackharrhy/worldview/core";
import type { WorldViewElement } from "@jackharrhy/worldview/element";
import {
  clientEntry,
  css,
  ref,
  type Handle,
  type SerializableProps,
} from "remix/component";

const rootStyle = css({ position: "relative", width: "100%" });
const mountStyle = css({ width: "100%" });
const helpStyle = css({
  background: "rgba(7, 16, 12, 0.72)",
  bottom: "0.625rem",
  color: "#d9f4df",
  fontSize: "0.6875rem",
  padding: "0.35rem 0.5rem",
  pointerEvents: "none",
  position: "absolute",
  right: "0.625rem",
});

interface BspViewerProps extends SerializableProps {
  bspUrl: string;
  paletteUrl?: string;
  wadUrls: string[];
  walkabilityUrl?: string;
  format?: BspFormat;
  gameAssets: Record<string, string>;
  skybox: Partial<Record<SkyboxSide, string>>;
  sprites: Record<string, string>;
  sounds: Record<string, string>;
  height?: number;
}

type SkyboxSide = "rt" | "bk" | "lf" | "ft" | "up" | "dn";

export const BspViewer = clientEntry(
  `${import.meta.url}#BspViewer`,
  function BspViewer(handle: Handle<BspViewerProps>) {
    return () => {
      const height = handle.props.height ?? 480;
      return (
        <div mix={rootStyle}>
          <div
            aria-label="Interactive BSP map"
            mix={[
              mountStyle,
              ref((element, signal) => {
                void mountWorldView(
                  element,
                  handle.props,
                  height,
                  signal,
                ).catch((cause: unknown) => {
                  if (signal.aborted) return;
                  console.error("Worldview: failed to initialize", cause);
                  element.textContent =
                    "The interactive map could not be loaded.";
                  element.setAttribute("role", "alert");
                });
              }),
            ]}
          />
          <div mix={helpStyle}>
            {handle.props.format === "quake2-bsp38"
              ? "Click to capture · WASD to fly"
              : "Click to capture · WASD to move · V toggles noclip · G toggles navigation"}
          </div>
        </div>
      );
    };
  },
);

async function mountWorldView(
  mount: Element,
  props: BspViewerProps,
  height: number,
  signal: AbortSignal,
): Promise<void> {
  const { defineWorldViewElement } =
    await import("@jackharrhy/worldview/element");
  if (signal.aborted) return;

  defineWorldViewElement();
  const worldView = document.createElement("world-view") as WorldViewElement;
  worldView.style.height = `${height}px`;
  worldView.style.width = "100%";
  worldView.setAttribute(
    "controls",
    props.format === "quake2-bsp38" ? "fly" : "walk",
  );
  worldView.source = worldSource(props);
  worldView.walkabilitySource = props.walkabilityUrl ?? null;
  worldView.addEventListener("warning", (event) => {
    console.warn("Worldview:", event.detail.message);
  });
  worldView.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.code !== "KeyG" || keyboardEvent.repeat) return;
    worldView.walkabilityVisible = !worldView.walkabilityVisible;
  });
  mount.append(worldView);
  signal.addEventListener("abort", () => worldView.remove(), { once: true });
}

function worldSource(props: BspViewerProps): WorldSource {
  return {
    bsp: props.bspUrl,
    ...(props.paletteUrl ? { palette: props.paletteUrl } : {}),
    ...(props.wadUrls.length ? { wads: props.wadUrls } : {}),
    ...(Object.keys(props.gameAssets).length
      ? { gameAssets: props.gameAssets }
      : {}),
    ...(isCompleteSkybox(props.skybox) ? { skybox: props.skybox } : {}),
    ...(Object.keys(props.sprites).length ? { sprites: props.sprites } : {}),
    ...(Object.keys(props.sounds).length ? { sounds: props.sounds } : {}),
  };
}

function isCompleteSkybox(
  skybox: Partial<Record<SkyboxSide, string>>,
): skybox is Record<SkyboxSide, string> {
  return (["rt", "bk", "lf", "ft", "up", "dn"] as const).every(
    (side) => typeof skybox[side] === "string",
  );
}
