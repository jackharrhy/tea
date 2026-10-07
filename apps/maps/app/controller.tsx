import { createController } from "remix/router";
import { routes } from "./routes.ts";
import { MapsPage } from "./page.tsx";
import { EditorPage } from "./editor-page.tsx";
import { ProjectsPage } from "./projects-page.tsx";
import { NewMapPage } from "./new-map-page.tsx";
import { NotFoundPage } from "./not-found-page.tsx";

function legacyId(reference: string): string | null {
  const id = reference.split("-", 1)[0];
  return /^[a-z0-9]{12}$/.test(id) ? id : null;
}

function redirectLegacy(request: Request, pathname: string) {
  const destination = new URL(request.url);
  destination.pathname = pathname;
  return Response.redirect(destination, 308);
}

function redirectLegacyMap(request: Request, projectId: string, mapId: string) {
  const destination = new URL(request.url);
  destination.pathname = "/editor";
  destination.search = "";
  destination.searchParams.set("hostedProject", projectId);
  destination.searchParams.set("hostedMap", mapId);
  return Response.redirect(destination, 308);
}

function legacyProject(request: Request, reference: string, section = "") {
  const id = legacyId(reference);
  return id ? redirectLegacy(request, `/projects/${id}${section}`) : null;
}

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
        return context.render(<NotFoundPage />, { status: 404 });
      return context.render(
        <ProjectsPage projectId={context.params.projectId} />,
      );
    },
    projectNewMap(context) {
      if (!/^[a-z0-9]{12}$/.test(context.params.projectId))
        return context.render(<NotFoundPage />, { status: 404 });
      return context.render(
        <ProjectsPage projectId={context.params.projectId} section="new-map" />,
      );
    },
    projectResources(context) {
      if (!/^[a-z0-9]{12}$/.test(context.params.projectId))
        return context.render(<NotFoundPage />, { status: 404 });
      return context.render(
        <ProjectsPage
          projectId={context.params.projectId}
          section="resources"
        />,
      );
    },
    projectAccess(context) {
      if (!/^[a-z0-9]{12}$/.test(context.params.projectId))
        return context.render(<NotFoundPage />, { status: 404 });
      return context.render(
        <ProjectsPage projectId={context.params.projectId} section="access" />,
      );
    },
    legacyProject(context) {
      return (
        legacyProject(context.request, context.params.projectRef) ??
        context.render(<NotFoundPage />, { status: 404 })
      );
    },
    legacyProjectNewMap(context) {
      return (
        legacyProject(context.request, context.params.projectRef, "/new-map") ??
        context.render(<NotFoundPage />, { status: 404 })
      );
    },
    legacyProjectResources(context) {
      return (
        legacyProject(
          context.request,
          context.params.projectRef,
          "/resources",
        ) ?? context.render(<NotFoundPage />, { status: 404 })
      );
    },
    legacyProjectAccess(context) {
      return (
        legacyProject(context.request, context.params.projectRef, "/access") ??
        context.render(<NotFoundPage />, { status: 404 })
      );
    },
    legacyHostedMap(context) {
      const projectId = legacyId(context.params.projectRef);
      const mapId = legacyId(context.params.mapRef);
      return projectId && mapId
        ? redirectLegacyMap(context.request, projectId, mapId)
        : context.render(<NotFoundPage />, { status: 404 });
    },
    notFound(context) {
      return context.render(<NotFoundPage />, { status: 404 });
    },
  },
});
