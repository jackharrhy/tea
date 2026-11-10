type SubscriberOption = {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

type ProcessedImage = {
  dataUri: string;
  sizeBytes: number;
  originalSizeBytes: number;
  width: number;
  height: number;
};

function element<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function parseData<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function initializeAudience(form: HTMLFormElement) {
  const mode = element<HTMLSelectElement>("#audienceMode");
  mode?.addEventListener("change", () => {
    document
      .querySelectorAll<HTMLElement>("[data-audience]")
      .forEach((node) => node.classList.add("hidden"));
    element<HTMLElement>(`[data-audience="${mode.value}"]`)?.classList.remove(
      "hidden",
    );
  });

  const address = element<HTMLInputElement>("#fromAddress");
  const fromName = element<HTMLInputElement>("#fromName");
  let lastListDefault = "";
  element<HTMLSelectElement>("#listId")?.addEventListener("change", (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    const next = select.selectedOptions[0]?.dataset.fromAddress ?? "";
    if (address && (!address.value || address.value === lastListDefault))
      address.value = next;
    if (fromName && !fromName.value && next)
      fromName.value = next.split("@")[0] ?? "";
    lastListDefault = next;
  });

  element<HTMLSelectElement>("#fromPersona")?.addEventListener(
    "change",
    (event) => {
      const select = event.currentTarget as HTMLSelectElement;
      const option = select.selectedOptions[0];
      const custom = element<HTMLElement>("#fromCustomFields");
      if (!option?.value) {
        if (custom) custom.style.display = "";
        if (address) address.required = true;
        return;
      }
      if (address) {
        address.value =
          option.dataset.fromAddress ||
          `${option.dataset.slug}@${option.dataset.fromDomain}`;
        address.required = false;
      }
      if (fromName) fromName.value = option.dataset.fromName ?? "";
      if (custom) custom.style.display = "none";
    },
  );

  address?.addEventListener("blur", () => {
    if (fromName && !fromName.value && address.value)
      fromName.value = address.value.split("@")[0] ?? "";
  });

  const localSchedule = element<HTMLInputElement>("#scheduledAtLocal");
  const utcSchedule = element<HTMLInputElement>("#scheduledAt");
  const utcLabel = element<HTMLElement>("#scheduledAtUtc");
  localSchedule?.addEventListener("change", () => {
    const utc = localSchedule.value
      ? new Date(localSchedule.value).toISOString()
      : "";
    if (utcSchedule) utcSchedule.value = utc;
    if (utcLabel)
      utcLabel.textContent = utc ? `UTC: ${new Date(utc).toUTCString()}` : "";
  });

  initializeSubscriberPicker(form);
}

function initializeSubscriberPicker(form: HTMLFormElement) {
  const subscribers = parseData<SubscriberOption[]>(
    form.dataset.subscribers,
    [],
  );
  const selected = new Set(
    parseData<number[]>(form.dataset.selectedSubscriberIds, []),
  );
  const search = element<HTMLInputElement>("#subscriberSearch");
  const results = element<HTMLElement>("#searchResults");
  const chips = element<HTMLElement>("#selectedSubscribers");
  const hidden = element<HTMLInputElement>("#subscriberIds");
  if (!search || !results || !chips || !hidden) return;

  const render = () => {
    chips.replaceChildren();
    selected.forEach((id) => {
      const subscriber = subscribers.find((candidate) => candidate.id === id);
      if (!subscriber) return;
      const chip = document.createElement("span");
      chip.className =
        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800";
      chip.textContent = subscriber.email;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.className =
        "ml-1 text-blue-600 hover:text-blue-800 cursor-pointer";
      remove.addEventListener("click", () => {
        selected.delete(id);
        render();
      });
      chip.appendChild(remove);
      chips.appendChild(chip);
    });
    hidden.value = [...selected].join(",");
  };

  search.addEventListener("input", () => {
    const query = search.value.toLowerCase();
    if (!query) {
      results.classList.add("hidden");
      return;
    }
    const matches = subscribers
      .filter((subscriber) => {
        const name = [subscriber.firstName ?? "", subscriber.lastName ?? ""]
          .join(" ")
          .trim();
        return (
          !selected.has(subscriber.id) &&
          (subscriber.email.toLowerCase().includes(query) ||
            name.toLowerCase().includes(query))
        );
      })
      .slice(0, 10);
    results.replaceChildren(
      ...matches.map((subscriber) => {
        const option = document.createElement("div");
        const name = [subscriber.firstName ?? "", subscriber.lastName ?? ""]
          .join(" ")
          .trim();
        option.className = "px-3 py-2 cursor-pointer hover:bg-gray-50 text-sm";
        option.textContent = `${subscriber.email}${name ? ` (${name})` : ""}`;
        option.addEventListener("click", () => {
          selected.add(subscriber.id);
          search.value = "";
          results.classList.add("hidden");
          render();
        });
        return option;
      }),
    );
    results.classList.toggle("hidden", matches.length === 0);
  });
  render();
}

function initializePreview() {
  const panel = element<HTMLElement>("#previewPanel");
  const frame = element<HTMLIFrameElement>("#previewFrame");
  const textarea = element<HTMLTextAreaElement>("#bodyMarkdown");
  const subject = element<HTMLInputElement>("#subject");
  if (!panel || !frame || !textarea || !subject) return;

  let timer: number | undefined;
  const update = async () => {
    if (!textarea.value.trim()) return;
    const response = await fetch("/admin/campaigns/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bodyMarkdown: textarea.value,
        subject: subject.value || "Preview",
        listName: "Preview",
        templateSlug:
          element<HTMLSelectElement>("#templateSlug")?.value || "newsletter",
        templateSections: collectTemplateSections(),
      }),
    });
    frame.srcdoc = await response.text();
  };
  const scheduleUpdate = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(update, 500);
  };
  textarea.addEventListener("input", scheduleUpdate);
  subject.addEventListener("input", scheduleUpdate);

  window.setPreviewWidth = (width: number | null) => {
    frame.style.width = width === null ? "100%" : `${width}px`;
    frame.style.maxWidth = frame.style.width;
    const label = element<HTMLElement>("#previewWidthLabel");
    if (label) label.textContent = width === null ? "" : `${width}px`;
  };
  window.togglePreviewPanel = () => {
    const opening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !opening);
    document.body.style.overflow = opening ? "hidden" : "";
    const button = element<HTMLElement>("#previewToggleBtn");
    if (button) button.textContent = opening ? "Close Preview" : "Preview";
    if (opening) void update();
  };
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.classList.contains("hidden"))
      window.togglePreviewPanel?.();
  });
}

function collectTemplateSections() {
  const sections: Record<string, string> = {};
  document
    .querySelectorAll<HTMLTextAreaElement>(
      "[data-template]:not(.hidden) [data-template-section]",
    )
    .forEach((field) => {
      if (field.dataset.templateSection)
        sections[field.dataset.templateSection] = field.value;
    });
  return sections;
}

function initializeTemplateSections(form: HTMLFormElement) {
  const select = element<HTMLSelectElement>("#templateSlug");
  const hidden = element<HTMLInputElement>("#templateSectionsJson");
  if (!select || !hidden) return;
  const showSelected = () => {
    document
      .querySelectorAll<HTMLElement>("[data-template]")
      .forEach((group) => {
        group.classList.toggle(
          "hidden",
          group.dataset.template !== select.value,
        );
      });
  };
  select.addEventListener("change", showSelected);
  form.addEventListener("submit", () => {
    hidden.value = JSON.stringify(collectTemplateSections());
  });
  showSelected();
}

function initializeImages() {
  const dropZone = element<HTMLElement>("#imageDropZone");
  const fileInput = element<HTMLInputElement>("#imageFileInput");
  const modal = element<HTMLElement>("#imageModal");
  const pendingField = element<HTMLInputElement>("#pendingImagesJson");
  if (!dropZone || !fileInput || !modal || !pendingField) return;
  const embed = element<HTMLButtonElement>("#imageEmbedBtn")!;
  const host = element<HTMLButtonElement>("#imageS3Btn")!;
  let processed: ProcessedImage | null = null;
  const pending: Record<string, string> = {};

  const insert = (text: string) => {
    const textarea = element<HTMLTextAreaElement>("#bodyMarkdown");
    if (!textarea) return;
    const start = textarea.selectionStart;
    textarea.setRangeText(text, start, textarea.selectionEnd, "end");
    textarea.dispatchEvent(new Event("input"));
  };
  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const data = new FormData();
    data.append("image", file);
    const response = await fetch("/admin/campaigns/upload-image", {
      method: "POST",
      body: data,
    });
    if (!response.ok) throw new Error("Failed to process image");
    processed = (await response.json()) as ProcessedImage;
    element<HTMLElement>("#imageModalName")!.textContent = file.name;
    element<HTMLElement>("#imageModalSize")!.textContent =
      `Original: ${formatBytes(processed.originalSizeBytes)} → ${formatBytes(processed.sizeBytes)} WebP (${processed.width}×${processed.height})`;
    embed.textContent = `Embed in email (${formatBytes(processed.sizeBytes)} inline, always displays)`;
    modal.classList.remove("hidden");
  };
  const handle = (file?: File) => {
    if (file) void upload(file).catch(() => alert("Failed to process image"));
  };
  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => handle(fileInput.files?.[0]));
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("border-blue-400", "bg-blue-50");
  });
  dropZone.addEventListener("dragleave", () =>
    dropZone.classList.remove("border-blue-400", "bg-blue-50"),
  );
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("border-blue-400", "bg-blue-50");
    handle(event.dataTransfer?.files[0]);
  });
  embed.addEventListener("click", () => {
    if (processed) insert(`\n![image](${processed.dataUri})\n`);
    modal.classList.add("hidden");
  });
  host.addEventListener("click", () => {
    if (!processed) return;
    const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    pending[id] = processed.dataUri;
    pendingField.value = JSON.stringify(pending);
    insert(`\n<!-- s3-pending:${id} -->\n`);
    modal.classList.add("hidden");
  });
  element<HTMLButtonElement>("#imageModalClose")?.addEventListener(
    "click",
    () => modal.classList.add("hidden"),
  );
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.classList.add("hidden");
  });
}

export function initializeCampaignEditor() {
  const form = document.querySelector<HTMLFormElement>(
    "form[data-campaign-editor]",
  );
  if (!form || form.dataset.initialized) return;
  form.dataset.initialized = "true";
  initializeAudience(form);
  initializeTemplateSections(form);
  initializePreview();
  initializeImages();
}

declare global {
  interface Window {
    setPreviewWidth?: (width: number | null) => void;
    togglePreviewPanel?: () => void;
  }
}
