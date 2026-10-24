import { mapsGameProfile, type MapsGameProfile } from "@tea/maps-editor/core";
import { clientEntry, on, ref, type Handle } from "remix/component";

export const NewMapSetup = clientEntry(
  `file:///app/assets/new-map-setup.tsx#NewMapSetup`,
  function NewMapSetupComponent(handle: Handle) {
    let game: MapsGameProfile = "quake";
    let format: "quake" | "valve-220" = "valve-220";

    function selectGame(event: Event) {
      game = (event.currentTarget as HTMLSelectElement)
        .value as MapsGameProfile;
      const profile = mapsGameProfile(game);
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
      const profile = mapsGameProfile(game);
      return (
        <form
          action="/editor"
          method="get"
          id="new-map-form"
          data-rmx-document
          mix={ref((node: HTMLFormElement) => {
            node.dataset.clientReady = "true";
          })}
        >
          <input type="hidden" name="newMap" value="1" />
          <label for="new-map-name">Map name</label>
          <input
            id="new-map-name"
            name="name"
            defaultValue="untitled.map"
            required
            maxLength={120}
            autoFocus
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
