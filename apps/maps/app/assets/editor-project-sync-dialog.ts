import type { HostedProject } from "@tea/maps-protocol";
import type { MapProject } from "./editor-project.ts";
import {
  inspectLinkedMap,
  linkHostedProject,
  loadHostedProjectForSync,
  pullLinkedMap,
  pushLinkedMap,
  type ProjectSyncInspection,
} from "./editor-project-sync.ts";
import { compareSources } from "./editor-source-compare.ts";

const statusLabels = {
  "in-sync": "In sync",
  "first-link": "No common sync point",
  "local-changed": "Local changed",
  "hosted-changed": "Hosted changed",
  conflict: "Both changed",
} as const;

export function initProjectSyncDialog(options: {
  linked(project: MapProject): void;
  canSync(path: string): string | null;
  pulled(path: string, source: string): void;
}) {
  const openButton =
    document.querySelector<HTMLButtonElement>("#project-sync-open")!;
  const dialog = document.querySelector<HTMLDialogElement>(
    "#project-sync-dialog",
  )!;
  const status = document.querySelector<HTMLElement>("#project-sync-status")!;
  const setup = document.querySelector<HTMLElement>("#project-sync-setup")!;
  const linked = document.querySelector<HTMLElement>("#project-sync-linked")!;
  const projectId =
    document.querySelector<HTMLInputElement>("#project-sync-id")!;
  const loadButton =
    document.querySelector<HTMLButtonElement>("#project-sync-load")!;
  const mappings = document.querySelector<HTMLElement>(
    "#project-sync-mappings",
  )!;
  const linkButton =
    document.querySelector<HTMLButtonElement>("#project-sync-link")!;
  const mapInput =
    document.querySelector<HTMLSelectElement>("#project-sync-map")!;
  const inspectButton = document.querySelector<HTMLButtonElement>(
    "#project-sync-inspect",
  )!;
  const relinkButton = document.querySelector<HTMLButtonElement>(
    "#project-sync-relink",
  )!;
  const summary = document.querySelector<HTMLElement>("#project-sync-summary")!;
  const local = document.querySelector<HTMLTextAreaElement>(
    "#project-sync-local",
  )!;
  const hosted = document.querySelector<HTMLTextAreaElement>(
    "#project-sync-hosted",
  )!;
  const pullButton =
    document.querySelector<HTMLButtonElement>("#project-sync-pull")!;
  const pushButton =
    document.querySelector<HTMLButtonElement>("#project-sync-push")!;
  const closeButton = document.querySelector<HTMLButtonElement>(
    "#project-sync-close",
  )!;
  let project: MapProject | null = null;
  let loadedProject: HostedProject | null = null;
  let inspection: ProjectSyncInspection | null = null;
  let busy = false;
  let generation = 0;

  function showError(error: unknown) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }

  function setBusy(value: boolean) {
    busy = value;
    loadButton.disabled = value;
    linkButton.disabled = value || !loadedProject;
    inspectButton.disabled = value;
    relinkButton.disabled = value;
    pullButton.disabled =
      value || !inspection || inspection.status === "in-sync";
    pushButton.disabled =
      value ||
      !inspection ||
      inspection.status === "in-sync" ||
      inspection.hosted.role === "viewer";
    closeButton.disabled = value;
  }

  function renderInspection(value: ProjectSyncInspection | null) {
    inspection = value;
    local.value = value?.localSource ?? "";
    hosted.value = value?.hosted.source ?? "";
    const comparison = value
      ? compareSources(value.localSource, value.hosted.source)
      : null;
    summary.textContent = value
      ? `${statusLabels[value.status]} · hosted version ${value.hosted.mapVersion}${comparison?.same ? " · exact source match" : ` · first difference at line ${comparison?.firstDifferentLine ?? "end"}`}`
      : "Choose a linked map to compare";
    setBusy(busy);
  }

  async function inspect(path: string) {
    const current = project;
    if (!current || !path) return;
    const request = ++generation;
    renderInspection(null);
    setBusy(true);
    status.textContent = `Comparing ${path}`;
    try {
      const result = await inspectLinkedMap(current, path);
      if (request !== generation || current !== project) return;
      renderInspection(result);
      status.textContent = `${path}: ${statusLabels[result.status]}`;
    } catch (error) {
      if (request === generation) showError(error);
    } finally {
      if (request === generation) setBusy(false);
    }
  }

  function showLinked() {
    const current = project;
    if (!current?.manifest.hosted) return;
    setup.hidden = true;
    linked.hidden = false;
    mapInput.replaceChildren(
      ...current.manifest.hosted.maps.map(
        (map) => new Option(map.path, map.path),
      ),
    );
    renderInspection(null);
    if (mapInput.value) void inspect(mapInput.value);
    else status.textContent = "No maps are linked";
  }

  function showSetup() {
    setup.hidden = false;
    linked.hidden = true;
    mappings.replaceChildren();
    loadedProject = null;
    linkButton.disabled = true;
    status.textContent = "Enter a hosted project ID and pair local maps";
  }

  openButton.addEventListener("click", () => {
    if (!project) return;
    dialog.showModal();
    if (project.manifest.hosted) showLinked();
    else showSetup();
  });
  loadButton.addEventListener("click", async () => {
    const current = project;
    if (!current) return;
    setBusy(true);
    status.textContent = "Loading hosted project";
    try {
      const remote = await loadHostedProjectForSync(projectId.value, current);
      if (current !== project) return;
      loadedProject = remote;
      mappings.replaceChildren();
      for (const map of current.maps) {
        const label = document.createElement("label");
        label.textContent = map.path;
        const select = document.createElement("select");
        select.dataset.localPath = map.path;
        select.add(new Option("Not linked", ""));
        for (const candidate of remote.maps)
          select.add(new Option(candidate.name, candidate.id));
        label.append(select);
        mappings.append(label);
      }
      status.textContent = `${remote.name}: ${remote.maps.length} hosted maps available`;
    } catch (error) {
      loadedProject = null;
      mappings.replaceChildren();
      showError(error);
    } finally {
      setBusy(false);
    }
  });
  linkButton.addEventListener("click", async () => {
    const current = project;
    const remote = loadedProject;
    if (!current || !remote) return;
    const selected = Object.fromEntries(
      [...mappings.querySelectorAll<HTMLSelectElement>("select")].map(
        (input) => [input.dataset.localPath!, input.value],
      ),
    );
    setBusy(true);
    status.textContent = "Saving project links";
    try {
      const updated = await linkHostedProject(current, remote, selected);
      if (current !== project) return;
      project = updated;
      options.linked(updated);
      status.textContent = `Linked ${updated.manifest.hosted?.maps.length ?? 0} maps`;
      showLinked();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  });
  mapInput.addEventListener("change", () => void inspect(mapInput.value));
  relinkButton.addEventListener("click", () => showSetup());
  inspectButton.addEventListener("click", () => void inspect(mapInput.value));

  async function sync(direction: "pull" | "push") {
    const current = project;
    const reviewed = inspection;
    if (!current || !reviewed || busy) return;
    const reason = options.canSync(reviewed.path);
    if (reason) {
      status.textContent = reason;
      return;
    }
    setBusy(true);
    status.textContent =
      direction === "pull" ? "Pulling hosted source" : "Pushing local source";
    try {
      if (direction === "pull") {
        await pullLinkedMap(current, reviewed);
        if (current === project)
          options.pulled(reviewed.path, reviewed.hosted.source);
      } else {
        await pushLinkedMap(current, reviewed);
      }
      if (current === project) await inspect(reviewed.path);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }
  pullButton.addEventListener("click", () => void sync("pull"));
  pushButton.addEventListener("click", () => void sync("push"));
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });

  return {
    setProject(value: MapProject | null) {
      generation += 1;
      project = value;
      projectId.value = value?.manifest.hosted?.projectId ?? "";
      loadedProject = null;
      renderInspection(null);
      openButton.disabled = !value;
      if (dialog.open) dialog.close();
    },
  };
}
