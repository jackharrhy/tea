import { run } from "remix/component";

run({
  async loadModule(moduleUrl, exportName) {
    if (moduleUrl !== "/assets/world.js" || exportName !== "GurgurWorld")
      throw new Error(`Unknown Gurgur component ${moduleUrl}#${exportName}`);
    const module = await import("./world");
    return module.GurgurWorld;
  },
});
