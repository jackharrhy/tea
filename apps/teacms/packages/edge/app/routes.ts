import { get, post, route } from "remix/routes";

export const routes = route({
  health: get("/healthz"),
  published: route("/api/content", {
    list: get("/:collection"),
    entry: get("/:collection/:slug"),
  }),
  preview: route("/api/preview", {
    list: get("/:collection"),
    entry: get("/:collection/:slug"),
  }),
  mediaFile: get("/api/media/:id"),
  auth: route("/tea", {
    login: get("/login"),
    authenticate: post("/login"),
    logout: post("/logout"),
  }),
  admin: route("/tea", {
    index: get("/"),
    collection: get("/:collection"),
    newEntry: get("/:collection/new"),
    create: post("/:collection/new"),
    edit: get("/:collection/:slug"),
    save: post("/:collection/:slug"),
    publish: post("/:collection/:slug/publish"),
    unpublish: post("/:collection/:slug/unpublish"),
    history: get("/:collection/:slug/history"),
    restore: post("/:collection/:slug/history/:revision/restore"),
    media: get("/media"),
    upload: post("/media"),
  }),
  visual: route("/tea/visual", {
    entry: get("/:collection/:slug"),
    save: post("/:collection/:slug"),
  }),
});
