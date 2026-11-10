import "../style.css";
import { run } from "remix/component";

run({
  async loadModule(moduleUrl, exportName) {
    if (
      moduleUrl === "/assets/burger-atlas.js" &&
      exportName === "AtlasEditor"
    ) {
      const module = await import("../atlas/editor");
      return module.AtlasEditor;
    }
    if (moduleUrl !== "/assets/burger-game.js" || exportName !== "BurgerGame")
      if (
        moduleUrl === "/assets/burger-tools.js" &&
        exportName === "BurgerTools"
      ) {
        const module = await import("./burger-tools");
        return module.BurgerTools;
      } else
        throw new Error(`Unknown Burger component: ${moduleUrl}#${exportName}`);
    const module = await import("./burger-game");
    return module.BurgerGame;
  },
});
