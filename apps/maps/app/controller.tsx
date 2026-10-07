import { createController } from "remix/router";
import { routes } from "./routes.ts";
import { MapsPage } from "./page.tsx";
import { EditorPage } from "./editor-page.tsx";
import { ProjectsPage } from "./projects-page.tsx";
import { NewMapPage } from "./new-map-page.tsx";

export default createController(routes, {
  actions: {
    home(context) {
      return context.render(<MapsPage />);
    },
    editor(context) {
      return context.render(<EditorPage />);
    },
    newMap(context) {
      return context.render(<NewMapPage />);
    },
    projects(context) {
      return context.render(<ProjectsPage />);
    },
    project(context) {
      if (!/^[a-z0-9]{12}$/.test(context.params.projectId))
        return new Response("Not found", { status: 404 });
      return context.render(
        <ProjectsPage projectId={context.params.projectId} />,
      );
    },
    projectNewMap(context) {
      if (!/^[a-z0-9]{12}$/.test(context.params.projectId))
        return new Response("Not found", { status: 404 });
      return context.render(
        <ProjectsPage projectId={context.params.projectId} section="new-map" />,
      );
    },
    projectResources(context) {
      if (!/^[a-z0-9]{12}$/.test(context.params.projectId))
        return new Response("Not found", { status: 404 });
      return context.render(
        <ProjectsPage
          projectId={context.params.projectId}
          section="resources"
        />,
      );
    },
    projectAccess(context) {
      if (!/^[a-z0-9]{12}$/.test(context.params.projectId))
        return new Response("Not found", { status: 404 });
      return context.render(
        <ProjectsPage projectId={context.params.projectId} section="access" />,
      );
    },
  },
});
