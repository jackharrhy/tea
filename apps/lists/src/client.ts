import "htmx.org";
import { initializeCampaignEditor } from "./campaign-editor";

function markCurrentNavigation() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  document
    .querySelectorAll<HTMLAnchorElement>("nav a.nav-link")
    .forEach((link) => {
      const linkPath = new URL(link.href).pathname.replace(/\/$/, "") || "/";
      const current =
        linkPath === "/admin"
          ? path === "/admin"
          : path === linkPath || path.startsWith(`${linkPath}/`);
      if (current) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
}

function initializeTemplatePreview() {
  const workspace = document.querySelector<HTMLElement>(
    "[data-template-preview-workspace]",
  );
  const frame = workspace?.querySelector<HTMLIFrameElement>(
    "[data-template-preview-frame]",
  );
  if (!workspace || !frame || workspace.dataset.initialized) return;
  workspace.dataset.initialized = "true";
  const base = workspace.dataset.previewBase ?? "";
  let mode = "html";
  const refresh = () => {
    const params = new URLSearchParams({ mode });
    if (
      workspace.querySelector<HTMLInputElement>("[data-preview-remote]")
        ?.checked
    )
      params.set("remote", "1");
    frame.src = `${base}?${params}`;
  };
  workspace
    .querySelectorAll<HTMLButtonElement>("[data-preview-mode]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        mode = button.dataset.previewMode ?? "html";
        workspace
          .querySelectorAll<HTMLButtonElement>("[data-preview-mode]")
          .forEach((candidate) => {
            const active = candidate === button;
            candidate.classList.toggle("bg-gray-900", active);
            candidate.classList.toggle("text-white", active);
            candidate.classList.toggle("bg-white", !active);
            candidate.classList.toggle("text-gray-600", !active);
            candidate.setAttribute("aria-pressed", String(active));
          });
        refresh();
      }),
    );
  workspace
    .querySelectorAll<HTMLButtonElement>("[data-preview-width]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        frame.style.width =
          button.dataset.previewWidth === "full"
            ? "100%"
            : `${button.dataset.previewWidth}px`;
        workspace
          .querySelectorAll<HTMLButtonElement>("[data-preview-width]")
          .forEach((candidate) => {
            const active = candidate === button;
            candidate.classList.toggle("border-gray-900", active);
            candidate.classList.toggle("bg-gray-900", active);
            candidate.classList.toggle("text-white", active);
            candidate.classList.toggle("border-gray-300", !active);
            candidate.classList.toggle("bg-white", !active);
            candidate.classList.toggle("text-gray-600", !active);
            candidate.setAttribute("aria-pressed", String(active));
          });
      }),
    );
  workspace
    .querySelector<HTMLInputElement>("[data-preview-remote]")
    ?.addEventListener("change", refresh);
}

markCurrentNavigation();
initializeCampaignEditor();
initializeTemplatePreview();

document.addEventListener("htmx:responseError", () => {
  document.documentElement.dataset.requestError = "true";
  window.setTimeout(
    () => delete document.documentElement.dataset.requestError,
    2500,
  );
});

document.addEventListener("htmx:afterSwap", () => {
  markCurrentNavigation();
  initializeCampaignEditor();
  initializeTemplatePreview();
  document.querySelector<HTMLElement>("[autofocus]")?.focus();
});
