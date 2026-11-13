import { createController } from "remix/router";
import { getCspNonce } from "remix/middleware/csp";
import { routes } from "./routes.ts";
import { MapsPage } from "./page.tsx";
import { EditorPage } from "./editor-page.tsx";
import { ProjectsPage } from "./projects-page.tsx";
import { NewMapPage } from "./new-map-page.tsx";
import { NotFoundPage } from "./not-found-page.tsx";
import { HomePage } from "./home-page.tsx";

const viewerQueryKeys = [
  "example",
  "fixture",
  "bsp",
  "hostedBuild",
  "hostedProject",
  "hostedMap",
];

export default createController(routes, {
  actions: {
    home(context) {
      const search = new URL(context.request.url).searchParams;
      return context.render(
        viewerQueryKeys.some((key) => search.has(key)) ? (
          <MapsPage nonce={getCspNonce(context)} />
        ) : (
          <HomePage />
        ),
      );
    },
    viewer(context) {
      return context.render(<MapsPage nonce={getCspNonce(context)} />);
    },
    editor(context) {
      return context.render(<EditorPage nonce={getCspNonce(context)} />);
    },
    newMap(context) {
      return context.render(<NewMapPage nonce={getCspNonce(context)} />);
    },
    projects(context) {
      return context.render(
        <ProjectsPage
          nonce={getCspNonce(context)}
          createRequested={
            new URL(context.request.url).searchParams.get("create") === "1"
          }
        />,
      );
    },
    project(context) {
      if (!/^[a-z0-9]{12}$/.test(context.params.projectId))
        return context.render(<NotFoundPage />, { status: 404 });
      return context.render(
        <ProjectsPage
          projectId={context.params.projectId}
          nonce={getCspNonce(context)}
        />,
      );
    },
    projectNewMap(context) {
      if (!/^[a-z0-9]{12}$/.test(context.params.projectId))
        return context.render(<NotFoundPage />, { status: 404 });
      return context.render(
        <ProjectsPage
          projectId={context.params.projectId}
          section="new-map"
          nonce={getCspNonce(context)}
        />,
      );
    },
    projectResources(context) {
      if (!/^[a-z0-9]{12}$/.test(context.params.projectId))
        return context.render(<NotFoundPage />, { status: 404 });
      return context.render(
        <ProjectsPage
          projectId={context.params.projectId}
          section="resources"
          nonce={getCspNonce(context)}
        />,
      );
    },
    projectAccess(context) {
      if (!/^[a-z0-9]{12}$/.test(context.params.projectId))
        return context.render(<NotFoundPage />, { status: 404 });
      return context.render(
        <ProjectsPage
          projectId={context.params.projectId}
          section="access"
          nonce={getCspNonce(context)}
        />,
      );
    },
    notFound(context) {
      return context.render(<NotFoundPage />, { status: 404 });
    },
  },
});
