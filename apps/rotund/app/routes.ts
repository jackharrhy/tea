import { get, post, route } from "remix/routes";

export const routes = route({
  home: get("/"),
  health: get("/health"),
  auth: {
    login: post("/auth/login"),
    callback: get("/auth/callback"),
    logout: post("/auth/logout"),
  },
});
