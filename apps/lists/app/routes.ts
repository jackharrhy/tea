import { get, post, route } from "remix/routes";

export const routes = route({
  auth: route("auth", {
    login: get("/login"),
    callback: get("/callback"),
  }),
  admin: route("admin", {
    dashboard: get("/"),
    users: get("/users"),
    tokens: get("/tokens"),
  }),
  subscribe: route("subscribe", {
    show: get("/"),
    submit: post("/"),
  }),
  confirm: route("confirm", {
    domain: get("/:token/*domain"),
    all: get("/:token"),
  }),
  unsubscribe: route("unsubscribe", {
    list: get("/:token/:listId"),
    oneClickList: post("/:token/:listId"),
    all: get("/:token"),
    oneClickAll: post("/:token"),
  }),
  preferences: route("preferences", {
    show: get("/:token"),
    update: post("/:token"),
  }),
});
