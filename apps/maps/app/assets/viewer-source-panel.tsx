import type {
  BinarySource,
  CameraState,
  WorldSource,
} from "@jackharrhy/tea-maps-renderer";
import { clientEntry, on, ref, type Handle } from "remix/component";
import { exampleSource, examples } from "./examples.ts";
import {
  fixtureCamera,
  loadLocalFixtures,
  type LocalFixture,
} from "./local-fixtures.ts";
import { localMapMetadata } from "./local-map-metadata.ts";
import {
  cameraFromUrlParameters,
  sourceFromUrlParameters,
} from "./remote-input.ts";
import { localMapPath, localMaps, sourceFromFiles } from "./world-input.ts";

type RemoteField =
  | "bsp"
  | "gameBase"
  | "palette"
  | "wadBase"
  | "skyboxBase"
  | "spriteBase"
  | "soundBase";

const remoteFieldNames: readonly RemoteField[] = [
  "bsp",
  "gameBase",
  "palette",
  "wadBase",
  "skyboxBase",
  "spriteBase",
  "soundBase",
];

function openSource(
  source: WorldSource,
  label?: string,
  options?: { camera?: CameraState; walkability?: BinarySource },
) {
  window.dispatchEvent(
    new CustomEvent("tea-maps-open-source", {
      detail: { source, label, ...options },
    }),
  );
}

function viewerStatus(value: string) {
  window.dispatchEvent(
    new CustomEvent("tea-maps-viewer-status", { detail: value }),
  );
}

function replaceQuery(parameters: Record<string, string>) {
  const url = new URL(location.href);
  if (url.pathname === "/") url.pathname = "/viewer";
  url.search = new URLSearchParams(parameters).toString();
  history.replaceState(null, "", url);
}

export const ViewerSourcePanel = clientEntry(
  `file:///app/assets/viewer-source-panel.tsx#ViewerSourcePanel`,
  function ViewerSourcePanelComponent(handle: Handle) {
    let fixtures: readonly LocalFixture[] = [];
    let selectedExample = "goldsrc";
    let fixtureStatus = "";
    let filesStatus = "";
    let folderFiles: readonly File[] = [];
    let folderMaps: readonly File[] = [];
    let selectedFolderMap = 0;
    let folderStatus =
      "Choose a game or mod folder containing maps and assets. Files stay in this browser.";
    let userOpenedSource = false;
    function openExample(id: string, camera?: CameraState) {
      const fixture = fixtures.find(
        (item) => item.id === id || item.aliases.includes(id),
      );
      if (fixture) {
        selectedExample = fixture.id;
        openSource(fixture.source, fixture.label, {
          camera: camera ?? fixtureCamera(fixture),
          walkability: fixture.walkability,
        });
        handle.update();
        return;
      }
      const source = exampleSource(id);
      if (!source) {
        viewerStatus(`Example ${id} was not found`);
        return;
      }
      selectedExample = id;
      openSource(
        source,
        examples.find((example) => example.id === id)?.label ?? id,
        { camera },
      );
      handle.update();
    }

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-open-source",
        () => {
          userOpenedSource = true;
        },
        { signal: handle.signal },
      );
      const initial = new URL(location.href).searchParams;
      for (const field of remoteFieldNames) {
        const input = document.querySelector<HTMLInputElement>(
          `#url-form [name="${field}"]`,
        );
        if (input) input.value = initial.get(field) ?? "";
      }
      const initialRemote = sourceFromUrlParameters(initial);
      if (initialRemote)
        openSource(initialRemote, undefined, {
          camera: cameraFromUrlParameters(initial),
        });
      handle.update();
      void loadLocalFixtures()
        .then((loaded) => {
          fixtures = loaded;
          fixtureStatus = loaded.length
            ? `${loaded.length} local fixture${loaded.length === 1 ? "" : "s"} available`
            : "";
          if (
            !initialRemote &&
            !initial.has("hostedBuild") &&
            !userOpenedSource
          )
            openExample(
              initial.get("example") ?? initial.get("fixture") ?? "goldsrc",
              cameraFromUrlParameters(initial),
            );
          handle.update();
        })
        .catch((cause: unknown) => {
          fixtureStatus =
            cause instanceof Error ? cause.message : String(cause);
          if (
            !initialRemote &&
            !initial.has("hostedBuild") &&
            !userOpenedSource
          )
            openExample(
              initial.get("example") ?? initial.get("fixture") ?? "goldsrc",
              cameraFromUrlParameters(initial),
            );
          handle.update();
        });
    });

    async function openFiles(form: HTMLFormElement) {
      try {
        const input = form.querySelector<HTMLInputElement>("#files");
        const source = await sourceFromFiles(input?.files ?? []);
        if (!source) {
          viewerStatus("Choose at least one .bsp file");
          return;
        }
        filesStatus = "";
        userOpenedSource = true;
        openSource(source);
        replaceQuery({});
      } catch (cause) {
        filesStatus = cause instanceof Error ? cause.message : String(cause);
        viewerStatus(filesStatus);
      }
      handle.update();
    }

    async function openFolder() {
      const selected = folderMaps[selectedFolderMap];
      if (!selected) return;
      try {
        const [source, metadata] = await Promise.all([
          sourceFromFiles(folderFiles, selected),
          localMapMetadata(folderFiles, selected),
        ]);
        if (!source) return;
        userOpenedSource = true;
        openSource(source, metadata.label, metadata);
        replaceQuery({});
        folderStatus = `Opened ${localMapPath(selected)}`;
      } catch (cause) {
        folderStatus = cause instanceof Error ? cause.message : String(cause);
      }
      handle.update();
    }

    function openRemote(form: HTMLFormElement) {
      const data = new FormData(form);
      const parameters = new URLSearchParams();
      for (const field of remoteFieldNames) {
        const value = String(data.get(field) ?? "").trim();
        if (value) parameters.set(field, value);
      }
      const source = sourceFromUrlParameters(parameters);
      if (!source) return;
      userOpenedSource = true;
      openSource(source);
      replaceQuery(Object.fromEntries(parameters));
    }

    return () => (
      <div class="source-panel">
        <form
          id="example-form"
          mix={on<HTMLFormElement>("submit", (event) => {
            event.preventDefault();
            userOpenedSource = true;
            openExample(selectedExample);
            replaceQuery(
              fixtures.some((fixture) => fixture.id === selectedExample)
                ? { fixture: selectedExample }
                : { example: selectedExample },
            );
          })}
        >
          <label for="example">Explore an example</label>
          <select
            id="example"
            name="example"
            value={selectedExample}
            mix={on<HTMLSelectElement>("change", (event) => {
              selectedExample = event.currentTarget.value;
              handle.update();
            })}
          >
            {examples
              .filter((example) => example.selectable)
              .map((example) => (
                <option value={example.id}>{example.label}</option>
              ))}
            <optgroup
              id="local-examples"
              label="Local fixtures"
              hidden={fixtures.length === 0}
            >
              {fixtures.map((fixture) => (
                <option value={fixture.id}>
                  {fixture.namespace
                    ? `${fixture.namespace} · ${fixture.label}`
                    : fixture.label}
                </option>
              ))}
            </optgroup>
          </select>
          <button type="submit">Open example</button>
          <p class="hint">Generated maps; no game files needed.</p>
          <p id="local-fixtures-status" class="hint" role="status">
            {fixtureStatus}
          </p>
        </form>
        <form
          id="files-form"
          mix={on<HTMLFormElement>("submit", (event) => {
            event.preventDefault();
            void openFiles(event.currentTarget);
          })}
        >
          <label for="files">Local map and assets</label>
          <input
            id="files"
            name="files"
            type="file"
            multiple
            accept=".bsp,.wad,.lmp,.pal,.pcx,.wal,.spr,.wav,.mp3,.ogg,.tga,.png,.jpg,.jpeg"
          />
          <button type="submit">Open files</button>
          <p class="hint">
            Files stay in this browser. Include the map’s WADs for its textures.
          </p>
          <p id="files-status" class="hint" role="status">
            {filesStatus}
          </p>
        </form>
        <form
          id="folder-form"
          mix={on<HTMLFormElement>("submit", (event) => {
            event.preventDefault();
            void openFolder();
          })}
        >
          <label for="folder">Local game folder</label>
          <input
            id="folder"
            type="file"
            multiple
            mix={[
              ref((node: HTMLInputElement) => {
                node.setAttribute("webkitdirectory", "");
              }),
              on<HTMLInputElement>("change", (event) => {
                folderFiles = [...(event.currentTarget.files ?? [])];
                folderMaps = localMaps(folderFiles);
                selectedFolderMap = 0;
                folderStatus = folderMaps.length
                  ? `${folderMaps.length} map${folderMaps.length === 1 ? "" : "s"} found`
                  : "No .bsp maps found in that folder";
                handle.update();
              }),
            ]}
          />
          <label for="folder-map">Map in folder</label>
          <select
            id="folder-map"
            value={String(selectedFolderMap)}
            disabled={folderMaps.length === 0}
            mix={on<HTMLSelectElement>("change", (event) => {
              selectedFolderMap = Number(event.currentTarget.value);
              handle.update();
            })}
          >
            {folderMaps.map((file, index) => (
              <option value={String(index)}>{localMapPath(file)}</option>
            ))}
          </select>
          <button
            id="folder-open"
            type="submit"
            disabled={folderMaps.length === 0}
          >
            Open folder map
          </button>
          <p id="folder-status" class="hint" role="status">
            {folderStatus}
          </p>
        </form>
        <form
          id="url-form"
          mix={on<HTMLFormElement>("submit", (event) => {
            event.preventDefault();
            openRemote(event.currentTarget);
          })}
        >
          <label for="bsp-url">BSP URL</label>
          <input
            id="bsp-url"
            name="bsp"
            type="text"
            placeholder="https://example.com/maps/map.bsp"
            required
          />
          <label for="game-base-url">Game asset root (optional)</label>
          <input
            id="game-base-url"
            name="gameBase"
            type="text"
            placeholder="https://example.com/game/"
          />
          <details class="url-overrides">
            <summary>Asset overrides</summary>
            <div class="url-overrides-fields">
              {(
                [
                  ["palette", "palette-url", "Palette URL", "gfx/palette.lmp"],
                  [
                    "wadBase",
                    "wad-base-url",
                    "WAD base URL",
                    "https://example.com/wads/",
                  ],
                  [
                    "skyboxBase",
                    "skybox-base-url",
                    "Skybox base URL",
                    "https://example.com/env/",
                  ],
                  [
                    "spriteBase",
                    "sprite-base-url",
                    "Sprite base URL",
                    "https://example.com/sprites/",
                  ],
                  [
                    "soundBase",
                    "sound-base-url",
                    "Sound base URL",
                    "https://example.com/sound/",
                  ],
                ] as const
              ).map(([field, id, label, placeholder]) => (
                <div>
                  <label for={id}>{label}</label>
                  <input
                    id={id}
                    name={field}
                    type="text"
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
          </details>
          <button type="submit">Open URL</button>
          <p class="hint">Remote hosts must allow browser CORS requests.</p>
        </form>
      </div>
    );
  },
);
