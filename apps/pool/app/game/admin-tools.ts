import type { RoomSettings, AdminMetrics } from "@harrhy/pool-protocol";
import type { Account } from "./account";
import "./admin-tools.css";

type Player = { id: string; name: string; connected: boolean; bot: boolean };
type AdminState = { settings: RoomSettings; players: Player[] };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text: string, action?: () => void) {
  const node = element("button", text);
  node.type = "button";
  if (action) node.addEventListener("click", action);
  return node;
}
function field(label: string, input: HTMLInputElement | HTMLSelectElement) {
  const node = element("label", label);
  node.append(input);
  return node;
}
function numberInput(min: number, max: number, step: string) {
  const input = element("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = step;
  input.required = true;
  return input;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed. Try again.";
}
function plot(title: string, values: number[], labels: string[], unit: string) {
  const figure = element("figure");
  figure.append(element("figcaption", title));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 360 100");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${title}: ${values.map((n, i) => `${labels[i]}: ${n.toFixed(3)} ${unit}`).join("; ") || "No observations"}`,
  );
  const max = Math.max(...values, 0);
  const baseline = document.createElementNS(svg.namespaceURI, "path");
  baseline.setAttribute("d", "M 0 92 H 360");
  baseline.setAttribute("class", "owner-chart-baseline");
  svg.append(baseline);
  values.forEach((value, index) => {
    const bar = document.createElementNS(svg.namespaceURI, "rect");
    const width = 360 / Math.max(1, values.length);
    const height = max > 0 ? (value / max) * 82 : 0;
    bar.setAttribute("x", String(index * width + 2));
    bar.setAttribute("y", String(92 - height));
    bar.setAttribute("width", String(Math.max(1, width - 4)));
    bar.setAttribute("height", String(height));
    const tip = document.createElementNS(svg.namespaceURI, "title");
    tip.textContent = `${labels[index]}: ${value} ${unit}`;
    bar.append(tip);
    svg.append(bar);
  });
  figure.append(
    svg,
    element(
      "p",
      max > 0
        ? `Peak ${Number(max.toFixed(3))} ${unit} · ${labels[0]} to ${labels.at(-1)}`
        : "No observations in this range.",
    ),
  );
  return figure;
}

export function installOwnerTools(
  account: Account,
  root: HTMLElement,
): () => void {
  if (!account.authenticated || !account.owner || !account.csrf)
    return () => {};
  const panel = element("section");
  panel.id = "owner-tools";
  panel.hidden = true;
  panel.tabIndex = -1;
  panel.setAttribute("aria-labelledby", "owner-tools-title");
  const title = element("h2", "Owner tools");
  title.id = "owner-tools-title";
  const toggle = button("Owner tools", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      panel.focus();
      void refresh(true);
    }
  });
  toggle.setAttribute("aria-controls", panel.id);
  toggle.setAttribute("aria-expanded", "false");
  const close = () => {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  };
  const heading = element("header");
  heading.append(title, button("Close", close));
  const status = element("p");
  status.setAttribute("role", "status");
  const room = element("form");
  const roomFields = element("fieldset");
  roomFields.disabled = true;
  roomFields.append(element("legend", "Room"));
  const intensity = numberInput(0, 3, "0.1");
  intensity.value = "1";
  const cutaway = element("input");
  cutaway.type = "checkbox";
  roomFields.append(
    field("Light intensity (0–3)", intensity),
    field("Raise tabletop 1 m to inspect returns", cutaway),
  );
  const gravityFields = element("div");
  gravityFields.className = "owner-gravity";
  const gravity = ["X", "Y", "Z"].map((axis, index) => {
    const input = numberInput(-15, 15, "0.01");
    input.value = String(index === 1 ? -9.81 : 0);
    gravityFields.append(field(`${axis} (m/s²)`, input));
    return input;
  });
  roomFields.append(
    element("h3", "Gravity (balls)"),
    element(
      "p",
      "Applies to all physical balls. Avatars use navigation movement. Gravity changes are blocked during active human matches.",
    ),
    gravityFields,
  );
  const defaults = button("Normal gravity", () => {
    gravity.forEach((input, i) => {
      input.value = String(i === 1 ? -9.81 : 0);
    });
  });
  const save = element("button", "Apply room settings");
  save.type = "submit";
  roomFields.append(defaults, save);
  room.append(roomFields);
  const rename = element("form");
  const renameFields = element("fieldset");
  renameFields.disabled = true;
  renameFields.append(element("legend", "Rename player"));
  const players = element("select");
  players.required = true;
  const name = element("input");
  name.required = true;
  name.maxLength = 24;
  const renameButton = element("button", "Rename");
  renameButton.type = "submit";
  renameFields.append(
    field("Player", players),
    field("Display name (1–24 characters)", name),
    renameButton,
  );
  rename.append(renameFields);
  const metrics = element("section");
  const updated = element("p", "Metrics have not loaded.");
  const metricsError = element("p");
  metricsError.setAttribute("role", "status");
  metrics.append(element("h3", "Recording metrics"));
  const charts = element("div");
  metrics.append(
    updated,
    metricsError,
    button("Refresh metrics and players", () => {
      void refresh(false);
    }),
    charts,
  );
  panel.append(heading, status, room, rename, metrics);
  const menu = root.querySelector("#menu nav");
  (menu ?? root).append(toggle);
  root.append(panel);
  let disposed = false;
  let refreshing = false;
  let mutating = false;
  let current: RoomSettings | null = null;
  let playerList: Player[] = [];
  const lifetime = new AbortController();
  const cleanup = () => {
    disposed = true;
    lifetime.abort();
    clearInterval(poll);
    toggle.remove();
    panel.remove();
  };

  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`/api/admin/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: lifetime.signal,
      headers:
        body === undefined
          ? {}
          : {
              "Content-Type": "application/json",
              "X-CSRF-Token": account.csrf!,
            },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 403) cleanup();
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error || `Request failed (${response.status}).`);
    return value as T;
  }
  function setFields(settings: RoomSettings) {
    current = settings;
    intensity.value = String(settings.lightIntensity);
    cutaway.checked = settings.cutaway;
    gravity.forEach((input, i) => {
      input.value = String(settings.gravity[i]);
    });
  }
  function renderMetrics(data: AdminMetrics) {
    const totals = element("dl");
    const summary = data.summary;
    for (const [label, value] of [
      ["Games", summary.games],
      ["Shots", summary.shots],
      ["Flagged shots", summary.flaggedShots],
      ["Client reports", summary.clientReports],
      ["Corrections", summary.correctionCount],
      ["Largest correction", `${summary.maxCorrection.toFixed(3)} m`],
      ["Recorded data", `${(summary.recordedBytes / 1024).toFixed(1)} KiB`],
    ])
      totals.append(element("dt", String(label)), element("dd", String(value)));
    const labels = data.series.map((row) =>
      new Date(row.at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    const histogramLabels = [
      ">1–25 mm",
      ">25–100 mm",
      ">100–500 mm",
      ">500 mm",
    ];
    const histogram = plot(
      "Correction sizes",
      data.histogram,
      histogramLabels,
      "corrections",
    );
    const counts = element(
      "p",
      histogramLabels
        .map((label, i) => `${label}: ${data.histogram[i] ?? 0}`)
        .join(" · "),
    );
    histogram.append(counts);
    const recent = element("ul");
    for (const shot of data.recent) {
      recent.append(
        element(
          "li",
          `${new Date(shot.startedAt).toLocaleTimeString()} · Table ${shot.tableId} · ${shot.flags.join(", ")} · Shot ${shot.id}`,
        ),
      );
    }
    if (!data.recent.length)
      recent.append(element("li", "No flagged shots recorded."));
    const errors = element("ul");
    for (const error of data.errors) {
      const item = element("li"),
        details = element("details");
      details.append(
        element(
          "summary",
          `${new Date(error.at).toLocaleTimeString()} · ${error.event}${error.shotId ? ` · Shot ${error.shotId}` : ""}`,
        ),
        element("pre", JSON.stringify(error, null, 2)),
      );
      item.append(details);
      errors.append(item);
    }
    if (!data.errors.length)
      errors.append(element("li", "No errors recorded."));
    charts.replaceChildren(
      totals,
      plot(
        "Shots over time",
        data.series.map((row) => row.shots),
        labels,
        "shots",
      ),
      plot(
        "Largest correction over time",
        data.series.map((row) => row.maxError),
        labels,
        "m",
      ),
      histogram,
      element("h3", "Recent flagged shots"),
      recent,
      element("h3", "Recent errors"),
      errors,
    );
    const activity = element("ul");
    for (const event of data.activity)
      activity.append(
        element(
          "li",
          `${new Date(event.at).toLocaleTimeString()} · ${String(event.action ?? event.event)} · ${String(event.phase ?? "")}`,
        ),
      );
    if (!data.activity.length)
      activity.append(element("li", "No owner activity recorded."));
    charts.append(element("h3", "Owner activity"), activity);
    updated.textContent = `Updated ${new Date().toLocaleTimeString()} · Latest ${data.window.shots} shots and ${data.window.reports} reports; totals cover retained data.`;
    metricsError.textContent = "";
  }
  async function refresh(loadSettings: boolean) {
    if (disposed || refreshing || mutating) return;
    refreshing = true;
    try {
      const [stateResult, metricsResult] = await Promise.allSettled([
        request<AdminState>("state"),
        request<AdminMetrics>("metrics"),
      ]);
      if (disposed) return;
      if (stateResult.status === "fulfilled" && !mutating) {
        const state = stateResult.value;
        if (loadSettings || !current) {
          setFields(state.settings);
        }
        roomFields.disabled = false;
        playerList = state.players;
        const selected = players.value;
        const placeholder = element("option", "Choose a player");
        placeholder.value = "";
        players.replaceChildren(
          placeholder,
          ...playerList.map((player) => {
            const option = element(
              "option",
              `${player.name}${player.bot ? " (bot)" : player.connected ? "" : " (offline)"}`,
            );
            option.value = player.id;
            return option;
          }),
        );
        const selectionExists = playerList.some(
          (player) => player.id === selected,
        );
        players.value = selectionExists ? selected : "";
        renameButton.disabled = !selectionExists;
        renameFields.disabled = playerList.length === 0;
        if (!selectionExists) name.value = "";
      } else if (stateResult.status === "rejected")
        status.textContent = `Could not load room controls: ${errorMessage(stateResult.reason)}`;
      if (metricsResult.status === "fulfilled")
        renderMetrics(metricsResult.value);
      else
        metricsError.textContent = `Could not refresh metrics: ${errorMessage(metricsResult.reason)} Use Refresh to retry.`;
    } finally {
      refreshing = false;
    }
  }
  async function mutate(action: () => Promise<void>) {
    if (mutating || disposed) return;
    mutating = true;
    roomFields.disabled = renameFields.disabled = true;
    status.textContent = "Applying change…";
    try {
      await action();
    } catch (error) {
      status.textContent = errorMessage(error);
    } finally {
      mutating = false;
      roomFields.disabled = current === null;
      renameFields.disabled = playerList.length === 0;
    }
  }
  room.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!current) return;
    const patch: Partial<RoomSettings> = {};
    const values = gravity.map(
      (input) => input.valueAsNumber,
    ) as RoomSettings["gravity"];
    if (intensity.valueAsNumber !== current.lightIntensity)
      patch.lightIntensity = intensity.valueAsNumber;
    if (cutaway.checked !== current.cutaway) patch.cutaway = cutaway.checked;
    if (values.some((value, i) => value !== current!.gravity[i]))
      patch.gravity = values;
    if (!Object.keys(patch).length) {
      status.textContent = "Room settings are already applied.";
      return;
    }
    void mutate(async () => {
      const result = await request<{
        settings: RoomSettings;
        auditWarning?: string;
      }>("settings", "PATCH", patch);
      setFields(result.settings);
      status.textContent =
        result.auditWarning ?? "Room settings applied to everyone in the hall.";
    });
  });
  players.addEventListener("change", () => {
    renameButton.disabled = !players.value;
    name.value =
      playerList.find((player) => player.id === players.value)?.name ?? "";
  });
  rename.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!players.value) return;
    void mutate(async () => {
      const renamed = await request<{
        id: string;
        name: string;
        auditWarning?: string;
      }>("rename", "POST", { id: players.value, name: name.value });
      const player = playerList.find(
        (rosterPlayer) => rosterPlayer.id === renamed.id,
      );
      if (player) player.name = renamed.name;
      players.selectedOptions[0].textContent = renamed.name;
      name.value = renamed.name;
      status.textContent = renamed.auditWarning ?? "Player renamed.";
    });
  });
  panel.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  for (const type of ["pointerdown", "pointerup", "wheel"])
    panel.addEventListener(type, (event) => event.stopPropagation());
  const poll = setInterval(() => {
    if (!panel.hidden && !document.hidden) void refresh(false);
  }, 10_000);
  return cleanup;
}
