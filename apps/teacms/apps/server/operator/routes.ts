import { get, post, route } from "remix/routes";

export const operatorRoutes = route({
  index: get("/"),
  login: get("/login"),
  design: get("/design"),
  authenticate: post("/login"),
  logout: post("/logout"),
  enter: post("/enter/:siteId"),
});
