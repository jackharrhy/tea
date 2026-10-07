import {
  HostedProjectResponseSchema,
  HostedSessionResponseSchema,
} from "@tea/maps-protocol";
import { createHostedMap } from "./editor-hosted-create.ts";
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

void showProject().catch((error: unknown) => {
  status.textContent = message(error);
});
