import { get, post, route } from "remix/routes";

export const routes = route({
  health: get("/health"),
  capabilities: get("/capabilities"),
  compile: post("/compile"),
  launch: post("/launch"),
});
