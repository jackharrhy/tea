# Maps workspace

Read this README and the Tea root guidance before editing. Keep app routes and UI in this workspace, and import the renderer and editor through their public package entry points. Use Remix 3 controllers and `css(...)` mixins for static UI. Do not add game assets to the repository. The local `cf` Worker owns viewer and editor presentation; hosted storage and collaboration belong to separate workspaces. Run this app's `check` and the affected package checks after changing their interfaces.
