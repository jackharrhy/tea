import { get, route } from "remix/routes";

export const routes = route({
  world: get("/"),
});
