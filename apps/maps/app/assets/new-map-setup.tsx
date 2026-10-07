import {
  worldviewGameProfile,
  type WorldviewGameProfile,
} from "@tea/maps-editor/core";
import { clientEntry, on, type Handle } from "remix/component";

export const NewMapSetup = clientEntry(
  `${import.meta.url}#NewMapSetup`,
  function NewMapSetupComponent(handle: Handle) {
    let name = "untitled.map";
    let game: WorldviewGameProfile = "quake";
    let format: "quake" | "valve-220" = "valve-220";

    function selectGame(event: Event) {
      game = (event.currentTarget as HTMLSelectElement)
        .value as WorldviewGameProfile;
      const profile = worldviewGameProfile(game);
      if (!profile.supportedFaceSyntaxes.includes(format))
        format = profile.defaultFaceSyntax;
      handle.update();
    }

    function selectFormat(event: Event) {
      format = (event.currentTarget as HTMLSelectElement)
        .value as typeof format;
      handle.update();
    }

    return () => {
      const profile = worldviewGameProfile(game);
      return (
        <form action="/editor" method="get" id="new-map-form" data-rmx-document>
          <input type="hidden" name="newMap" value="1" />
          <label for="new-map-name">Map name</label>
          <input
            id="new-map-name"
            name="name"
            value={name}
            required
            maxLength={120}
            autoFocus
            mix={on<HTMLInputElement>("input", (event) => {
              name = (event.currentTarget as HTMLInputElement).value;
            })}
          />
          <label for="new-map-game">Game</label>
          <select
            id="new-map-game"
            name="game"
            value={game}
            mix={on<HTMLSelectElement>("change", selectGame)}
          >
            <option value="quake">Quake</option>
            <option value="goldsrc">GoldSrc</option>
            <option value="quake2">Quake II</option>
            <option value="gower">Gower Complex</option>
          </select>
          <label for="new-map-format">Map format</label>
          <select
            id="new-map-format"
            name="format"
            value={format}
            mix={on<HTMLSelectElement>("change", selectFormat)}
          >
            <option
              value="valve-220"
              hidden={!profile.supportedFaceSyntaxes.includes("valve-220")}
            >
              Valve 220
            </option>
            <option
              value="quake"
              hidden={!profile.supportedFaceSyntaxes.includes("quake")}
            >
              Classic Quake
            </option>
          </select>
          <p id="new-map-game-description" class="projects-note">
            {profile.description}
          </p>
          <button type="submit">Open editor</button>
        </form>
      );
    };
  },
);
