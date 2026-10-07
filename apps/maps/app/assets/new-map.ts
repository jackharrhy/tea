import {
  worldviewGameProfile,
  type WorldviewGameProfile,
} from "@tea/maps-editor/core";

const game = document.querySelector<HTMLSelectElement>("#new-map-game")!;
const format = document.querySelector<HTMLSelectElement>("#new-map-format")!;
const description = document.querySelector<HTMLElement>(
  "#new-map-game-description",
)!;

function refreshGame() {
  const profile = worldviewGameProfile(game.value as WorldviewGameProfile);
  for (const option of format.options)
    option.hidden = !profile.supportedFaceSyntaxes.includes(
      option.value as "quake" | "valve-220",
    );
  if (
    !profile.supportedFaceSyntaxes.includes(
      format.value as "quake" | "valve-220",
    )
  )
    format.value = profile.defaultFaceSyntax;
  description.textContent = profile.description;
}

game.addEventListener("change", refreshGame);
refreshGame();
