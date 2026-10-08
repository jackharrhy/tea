import { run } from "remix/component";

const app = run({
  async loadModule(moduleUrl, exportName) {
    let module = await import(moduleUrl);
    return module[exportName];
  },
});

app.addEventListener("error", (event) => {
  console.error("Letters to Steve browser error:", event.error);
});

await app.ready();

if (import.meta.hot) {
  import.meta.hot.on("server:update", async () => {
    await app.ready();
    await app.frames.top.reload();
  });
}
