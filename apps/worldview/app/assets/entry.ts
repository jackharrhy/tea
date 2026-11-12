import { run } from "remix/component";

run({
  async loadModule(moduleUrl, exportName) {
    const module = await import(moduleUrl);
    return module[exportName];
  },
});
