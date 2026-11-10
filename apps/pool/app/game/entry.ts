import "./style.css";
import { run } from "remix/component";

run({
  async loadModule(moduleUrl, exportName) {
    if (moduleUrl !== "/assets/pool-game.js" || exportName !== "PoolGame")
      throw new Error(`Unknown Pool component: ${moduleUrl}#${exportName}`);
    const module = await import("./pool-game");
    return module.PoolGame;
  },
});
