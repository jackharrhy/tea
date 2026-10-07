import {
  HostedProjectResponseSchema,
  HostedProjectsResponseSchema,
  HostedSessionResponseSchema,
  type HostedProject,
} from "@tea/maps-protocol";
import {
  createHostedMap,
  createHostedProject,
} from "./editor-hosted-create.ts";
import { openLinkedLocalProject } from "./project-local.ts";
import { listRecentProjects } from "./editor-recent-projects.ts";
import { readHostedApi } from "./hosted-api.ts";
import { showProjectAccess } from "./project-access.ts";
import { showProjectResources } from "./project-resources.ts";

const root = document.querySelector<HTMLElement>("#projects-app")!;
const status = document.querySelector<HTMLElement>("#projects-status")!;
const login = document.querySelector<HTMLAnchorElement>("#projects-login")!;
const projectId = root.dataset.projectId ?? "";
const section = root.dataset.section ?? "maps";
const gameNames: Record<string, string> = {
  quake: "Quake",
  goldsrc: "GoldSrc",
  gower: "Gower Complex",
};

login.href = `/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function row(name: string, detail: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "project-row";
  const title = document.createElement("strong");
  title.textContent = name;
  const subtitle = document.createElement("small");
  subtitle.textContent = detail;
  item.append(title, subtitle);
  return item;
}

async function showRecentProjects() {
  const list = document.querySelector<HTMLElement>("#local-projects-list")!;
  const recents = await listRecentProjects();
  if (!recents.length) {
    list.textContent = "No recent local projects on this device";
    return;
  }
  for (const recent of recents) {
    const item = row(recent.name, recent.lastMapPath ?? recent.handle.name);
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Open in editor";
    open.addEventListener("click", async () => {
      open.disabled = true;
      try {
        const permission =
          (await recent.handle.queryPermission?.({ mode: "readwrite" })) ??
          "granted";
        if (permission !== "granted") {
          const granted = await recent.handle.requestPermission?.({
            mode: "readwrite",
          });
          if (granted !== "granted")
            throw new Error("Project folder permission was not granted");
        }
        location.href = `/editor?recentProject=${encodeURIComponent(recent.id)}`;
      } catch (error) {
        status.textContent = message(error);
        open.disabled = false;
      }
    });
    item.append(open);
    list.append(item);
  }
}

async function showHostedProjects() {
  const session = await readHostedApi(
    "/api/session",
    HostedSessionResponseSchema,
  );
  if (!session.user) {
    login.hidden = false;
    status.textContent = "Sign in to browse hosted projects";
    return;
  }
  const response = await readHostedApi(
    "/api/projects",
    HostedProjectsResponseSchema,
  );
  const list = document.querySelector<HTMLElement>("#hosted-projects-list")!;
  if (!response.projects.length) list.textContent = "No hosted projects yet";
  for (const project of response.projects) {
    const link = document.createElement("a");
    link.dataset.rmxDocument = "";
    link.className = "project-row";
    link.href = `/projects/${encodeURIComponent(project.id)}`;
    const title = document.createElement("strong");
    title.textContent = project.name;
    const detail = document.createElement("small");
    detail.textContent = `${gameNames[project.game]} · ${project.role}`;
    link.append(title, detail);
    list.append(link);
  }
  const create =
    document.querySelector<HTMLDetailsElement>("#projects-create")!;
  const form = document.querySelector<HTMLFormElement>(
    "#projects-create-form",
  )!;
  create.hidden = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    submit.disabled = true;
    status.textContent = "Creating hosted project";
    try {
      const data = new FormData(form);
      const project = await createHostedProject(
        String(data.get("name") ?? ""),
        String(data.get("game") ?? "quake"),
      );
      location.href = `/projects/${encodeURIComponent(project.id)}`;
    } catch (error) {
      status.textContent = message(error);
      submit.disabled = false;
    }
  });
  status.textContent = `Signed in as ${session.user.displayName}`;
}

function showMaps(project: HostedProject) {
  const list = document.querySelector<HTMLElement>("#project-maps-list")!;
  list.replaceChildren();
  if (!project.maps.length) list.textContent = "No maps in this project yet";
  for (const map of project.maps) {
    const item = row(
      map.name,
      map.format === "quake" ? "Classic Quake" : "Valve 220",
    );
    const actions = document.createElement("div");
    actions.className = "project-actions";
    const edit = document.createElement("a");
    edit.dataset.rmxDocument = "";
    edit.href = `/editor?hostedMap=${encodeURIComponent(map.id)}`;
    edit.textContent = "Open in editor";
    const view = document.createElement("a");
    view.dataset.rmxDocument = "";
    view.href = `/?hostedProject=${encodeURIComponent(project.id)}&hostedMap=${encodeURIComponent(map.id)}`;
    view.textContent = "View a build";
    actions.append(edit, view);
    item.append(actions);
    list.append(item);
  }
}

async function showProject() {
  const session = await readHostedApi(
    "/api/session",
    HostedSessionResponseSchema,
  );
  if (!session.user) {
    login.hidden = false;
    status.textContent = "Sign in to open this project";
    return;
  }
  const response = await readHostedApi(
    `/api/projects/${encodeURIComponent(projectId)}`,
    HostedProjectResponseSchema,
  );
  const project = response.project;
  document.title = `${project.name} · Maps · Tea`;
  document.querySelector<HTMLElement>("#project-name")!.textContent =
    project.name;
  document.querySelector<HTMLElement>("#project-meta")!.textContent =
    `${gameNames[project.game]} · ${project.role}`;
  document.querySelector<HTMLElement>("#project-access-tab")!.hidden =
    project.role !== "owner";
  document.querySelector<HTMLElement>("#project-new-map-tab")!.hidden =
    project.role === "viewer";
  if (section === "resources") {
    await showProjectResources(project);
    status.textContent = "";
    return;
  }
  if (section === "access") {
    await showProjectAccess(project);
    status.textContent = "";
    return;
  }
  if (section === "maps") {
    showMaps(project);
    const openLocal = document.querySelector<HTMLButtonElement>(
      "#project-open-local",
    )!;
    openLocal.addEventListener("click", async () => {
      openLocal.disabled = true;
      try {
        const recentId = await openLinkedLocalProject(project);
        if (recentId)
          location.href = `/editor?recentProject=${encodeURIComponent(recentId)}`;
      } catch (error) {
        status.textContent = message(error);
      } finally {
        openLocal.disabled = false;
      }
    });
    status.textContent = "";
    return;
  }
  const create = document.querySelector<HTMLElement>("#project-map-create")!;
  create.hidden = project.role === "viewer";
  if (create.hidden) {
    status.textContent = "Editor access required to create a map";
    return;
  }
  const form = document.querySelector<HTMLFormElement>(
    "#project-map-create-form",
  )!;
  const format = document.querySelector<HTMLSelectElement>(
    "#project-map-format",
  )!;
  format.querySelector<HTMLOptionElement>('option[value="quake"]')!.hidden =
    project.game !== "quake";
  if (project.game !== "quake") format.value = "valve-220";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    submit.disabled = true;
    status.textContent = "Creating hosted map";
    try {
      const data = new FormData(form);
      const file =
        document.querySelector<HTMLInputElement>("#project-map-file")!
          .files?.[0] ?? null;
      const map = await createHostedMap(
        project.id,
        project.game,
        String(data.get("name") ?? ""),
        String(data.get("format") ?? "valve-220"),
        file,
      );
      location.href = `/editor?hostedMap=${encodeURIComponent(map.id)}`;
    } catch (error) {
      status.textContent = message(error);
      submit.disabled = false;
    }
  });
  status.textContent = "";
}

if (projectId) {
  void showProject().catch((error: unknown) => {
    status.textContent = message(error);
  });
} else {
  void showRecentProjects().catch((error: unknown) => {
    document.querySelector<HTMLElement>("#local-projects-list")!.textContent =
      `Recent projects are unavailable: ${message(error)}`;
  });
  void showHostedProjects().catch((error: unknown) => {
    status.textContent = `Hosted projects are unavailable: ${message(error)}`;
  });
}
