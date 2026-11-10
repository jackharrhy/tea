import "../style.css";
import { run } from "remix/component";

run({
  async loadModule(moduleUrl, exportName) {
    if (moduleUrl !== "/assets/burger-game.js" || exportName !== "BurgerGame")
      throw new Error(`Unknown Burger component: ${moduleUrl}#${exportName}`);
    const module = await import("./burger-game");
    return module.BurgerGame;
  },
});
