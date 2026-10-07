import {
  HostedProjectResponseSchema,
  HostedSessionResponseSchema,
} from "@tea/maps-protocol";
import { readHostedApi } from "./hosted-api.ts";
import { showProjectResources } from "./project-resources.ts";

const root = document.querySelector<HTMLElement>("#projects-app")!;
const status = document.querySelector<HTMLElement>("#projects-status")!;
const login = document.querySelector<HTMLAnchorElement>("#projects-login")!;
const projectId = root.dataset.projectId ?? "";
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
  await showProjectResources(project);
  status.textContent = "";
}

void showProject().catch((error: unknown) => {
  status.textContent = message(error);
});
