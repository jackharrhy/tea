import type { HostedBuild } from "@tea/maps-protocol";
import { clientEntry, on, type Handle } from "remix/component";
import {
  hostedBuildArtifactPath,
  type HostedBuildHistoryContext,
} from "./editor-hosted-builds.ts";

export const EditorHostedBuilds = clientEntry(
  `file:///app/assets/editor-hosted-builds-panel.tsx#EditorHostedBuilds`,
  function EditorHostedBuildsComponent(handle: Handle) {
    let context: HostedBuildHistoryContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-hosted-builds-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-hosted-builds-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-hosted-builds-state",
        (event) => {
          context = (event as CustomEvent<HostedBuildHistoryContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-hosted-builds-ready"));
    });

    return () => {
      const map = context?.map;
      const builds = context?.builds ?? [];
      return (
        <details id="hosted-builds" hidden={!map}>
          <summary>Hosted build history</summary>
          <button
            id="hosted-builds-refresh"
            type="button"
            disabled={!map || context?.refreshing}
            mix={on("click", () => context?.refresh())}
          >
            Refresh builds
          </button>
          <p id="hosted-builds-status" role="status">
            {context?.status ?? ""}
          </p>
          <ul id="hosted-builds-list">
            {map && builds.length === 0 && <li>No hosted builds yet</li>}
            {map &&
              builds
                .toSorted((a, b) => b.createdAt - a.createdAt)
                .map((build: HostedBuild) => {
                  const bsp = build.result?.artifacts?.find(
                    (artifact) => artifact.kind === "bsp",
                  );
                  const path = bsp
                    ? hostedBuildArtifactPath(map.id, build.id, bsp.sha256)
                    : null;
                  return (
                    <li>
                      <span>
                        {build.quality} · v{build.mapVersion} · {build.status}
                        {build.result?.error ? ` · ${build.result.error}` : ""}
                      </span>
                      {path && bsp && build.status === "succeeded" && (
                        <a href={path} download={bsp.name}>
                          Download BSP
                        </a>
                      )}
                      {path &&
                        build.status === "succeeded" &&
                        build.mapVersion === context?.currentVersion() && (
                          <button
                            type="button"
                            mix={on("click", () =>
                              context?.preview(build, path),
                            )}
                          >
                            Preview
                          </button>
                        )}
                    </li>
                  );
                })}
          </ul>
        </details>
      );
    };
  },
);
