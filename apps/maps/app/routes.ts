import { get, route } from "remix/routes";

export const routes = route({
  home: get("/"),
  editor: get("/editor"),
  newMap: get("/new-map"),
  projects: get("/projects"),
  project: get("/projects/:projectId"),
  projectNewMap: get("/projects/:projectId/new-map"),
  projectResources: get("/projects/:projectId/resources"),
  projectAccess: get("/projects/:projectId/access"),
});
