import type { WorldSource } from "@jackharrhy/tea-maps-renderer";
import type { BspFormat } from "@jackharrhy/tea-maps-renderer/core";
import type { MapsViewElement } from "@jackharrhy/tea-maps-renderer/element";
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
                void mountMapsView(element, handle.props, height, signal).catch(
                  (cause: unknown) => {
                    if (signal.aborted) return;
                    console.error("Maps: failed to initialize", cause);
                    element.textContent =
                      "The interactive map could not be loaded.";
                    element.setAttribute("role", "alert");
                  },
                );
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

async function mountMapsView(
  mount: Element,
  props: BspViewerProps,
  height: number,
  signal: AbortSignal,
): Promise<void> {
  const { defineMapsViewElement } =
    await import("@jackharrhy/tea-maps-renderer/element");
  if (signal.aborted) return;

  defineMapsViewElement();
  const mapsView = document.createElement("tea-map-view") as MapsViewElement;
  mapsView.style.height = `${height}px`;
  mapsView.style.width = "100%";
  mapsView.setAttribute(
    "controls",
    props.format === "quake2-bsp38" ? "fly" : "walk",
  );
  mapsView.source = worldSource(props);
  mapsView.walkabilitySource = props.walkabilityUrl ?? null;
  mapsView.addEventListener("warning", (event) => {
    console.warn("Maps:", event.detail.message);
  });
  mapsView.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.code !== "KeyG" || keyboardEvent.repeat) return;
    mapsView.walkabilityVisible = !mapsView.walkabilityVisible;
  });
  mount.append(mapsView);
  signal.addEventListener("abort", () => mapsView.remove(), { once: true });
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
