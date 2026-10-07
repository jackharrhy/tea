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
  legacyProject: get("/project/:projectRef"),
  legacyProjectNewMap: get("/project/:projectRef/new-map"),
  legacyProjectResources: get("/project/:projectRef/resources"),
  legacyProjectAccess: get("/project/:projectRef/access"),
  legacyHostedMap: get("/project/:projectRef/map/:mapRef"),
  notFound: get("/*path"),
});
