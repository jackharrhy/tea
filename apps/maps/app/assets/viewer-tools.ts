import {
  analyzeEntitySupport,
  planOverview,
  type CameraState,
  type MapDiagnostics,
  type OverviewCaptureOptions,
} from "@tea/maps-renderer";
import type { WorldViewElement } from "@tea/maps-renderer/element";
import { serializeWalkability } from "@tea/maps-renderer/walkability";

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function formatMapDetails(
  diagnostics: MapDiagnostics,
  entityCount: number,
): string {
  return [
    `${diagnostics.format.toUpperCase()} ${diagnostics.version}`,
    `${diagnostics.triangles.toLocaleString()} triangles · ${diagnostics.faces.toLocaleString()} faces`,
    `${diagnostics.batches.toLocaleString()} batches · ${diagnostics.materials.toLocaleString()} materials · ${diagnostics.lightmapPages.toLocaleString()} lightmaps`,
    `${diagnostics.sprites.toLocaleString()} sprites · ${diagnostics.loadedSounds.toLocaleString()} ambient / ${diagnostics.loadedMusic.toLocaleString()} music / ${diagnostics.playerSounds.toLocaleString()} player sounds · ${entityCount.toLocaleString()} entities`,
    `Loaded in ${Math.round(diagnostics.loadMilliseconds)} ms`,
  ].join("\n");
}

export function initViewerTools(element: WorldViewElement): {
  reset(): void;
  setInitialCamera(camera: CameraState | undefined): void;
} {
  const mapName = document.querySelector<HTMLElement>("#map-name")!;
  const safeMapName = () =>
    mapName.textContent
      ?.replace(/\.bsp$/iu, "")
      .replace(/[^a-z0-9_-]+/giu, "-") || "map";
  const details = document.querySelector<HTMLOutputElement>("#map-details")!;
  const warnings = document.querySelector<HTMLOutputElement>("#map-warnings")!;
  const entityCounts =
    document.querySelector<HTMLOutputElement>("#entity-counts")!;
  const entityClasses =
    document.querySelector<HTMLUListElement>("#entity-classes")!;
  const toolStatus =
    document.querySelector<HTMLOutputElement>("#map-tool-status")!;
  const overviewSize =
    document.querySelector<HTMLSelectElement>("#overview-size")!;
  const overviewLighting =
    document.querySelector<HTMLSelectElement>("#overview-lighting")!;
  const overviewRotation =
    document.querySelector<HTMLSelectElement>("#overview-rotation")!;
  const overviewCutaway =
    document.querySelector<HTMLInputElement>("#overview-cutaway")!;
  const overviewZMin =
    document.querySelector<HTMLInputElement>("#overview-z-min")!;
  const overviewZMax =
    document.querySelector<HTMLInputElement>("#overview-z-max")!;
  const overviewTransparent = document.querySelector<HTMLInputElement>(
    "#overview-transparent",
  )!;
  const overviewStatus =
    document.querySelector<HTMLOutputElement>("#overview-status")!;
  const downloadOverview =
    document.querySelector<HTMLButtonElement>("#download-overview")!;
  const spacing = document.querySelector<HTMLInputElement>(
    "#walkability-spacing",
  )!;
  const probeJumps =
    document.querySelector<HTMLInputElement>("#walkability-jumps")!;
  const generateWalkability = document.querySelector<HTMLButtonElement>(
    "#generate-walkability",
  )!;
  const showWalkability =
    document.querySelector<HTMLInputElement>("#show-walkability")!;
  const walkabilityDetails = document.querySelector<HTMLOutputElement>(
    "#walkability-details",
  )!;
  const downloadWalkability = document.querySelector<HTMLButtonElement>(
    "#download-walkability",
  )!;
  const walkabilityFile =
    document.querySelector<HTMLInputElement>("#walkability-file")!;
  const clearWalkability =
    document.querySelector<HTMLButtonElement>("#clear-walkability")!;
  const audioDetails =
    document.querySelector<HTMLOutputElement>("#audio-details")!;
  const audioRoom = document.querySelector<HTMLOutputElement>("#audio-room")!;
  const enableAudio =
    document.querySelector<HTMLButtonElement>("#enable-audio")!;
  const muteAudio = document.querySelector<HTMLInputElement>("#mute-audio")!;
  const audioVolume =
    document.querySelector<HTMLInputElement>("#audio-volume")!;
  const playerVolume =
    document.querySelector<HTMLInputElement>("#player-volume")!;
  const musicVolume =
    document.querySelector<HTMLInputElement>("#music-volume")!;
  const musicTrack = document.querySelector<HTMLSelectElement>("#music-track")!;
  const musicStatus =
    document.querySelector<HTMLOutputElement>("#music-status")!;
  const playMusic = document.querySelector<HTMLButtonElement>("#play-music")!;
  const stopMusic = document.querySelector<HTMLButtonElement>("#stop-music")!;
  let initialCamera: CameraState | undefined;
  let warningMessages: string[] = [];
  let musicLoading = false;

  function report(error: unknown) {
    toolStatus.textContent =
      error instanceof Error ? error.message : String(error);
  }

  function updateWalkability() {
    const runtime = element.viewer;
    const graph = runtime?.walkability;
    walkabilityDetails.textContent = graph
      ? `${graph.nodes.length.toLocaleString()} nodes · ${graph.edges.length.toLocaleString()} edges`
      : "No graph loaded";
    showWalkability.checked = runtime?.walkabilityVisible ?? false;
    showWalkability.disabled = !graph;
    downloadWalkability.disabled = !graph;
    clearWalkability.disabled = !graph;
  }

  function updateAudio() {
    const audio = element.viewer?.audio;
    if (!audio) return;
    audioDetails.textContent = audio.enabled
      ? audio.suspended
        ? "Sound paused"
        : "Sound enabled"
      : "Sound off";
    audioRoom.textContent = `Room: ${audio.roomType === 0 ? "0 · off" : audio.roomType}`;
    muteAudio.checked = audio.muted;
    audioVolume.value = String(audio.volume);
    playerVolume.value = String(audio.playerVolume);
    musicVolume.value = String(audio.musicVolume);
    if (audio.musicEntityIndex !== null) {
      musicTrack.value = String(audio.musicEntityIndex);
    }
    musicStatus.textContent = musicTrack.disabled
      ? "No map music"
      : audio.musicPlaying
        ? "Playing"
        : "Stopped";
    playMusic.disabled = musicTrack.disabled || musicLoading;
    stopMusic.disabled = !audio.musicPlaying;
  }

  function reset() {
    initialCamera = undefined;
    warningMessages = [];
    details.textContent = "Loading map";
    warnings.textContent = "";
    entityCounts.textContent = "Load a map to inspect entities";
    entityClasses.replaceChildren();
    toolStatus.textContent = "";
    overviewStatus.textContent = "Load a map to export";
    overviewZMin.value = "";
    overviewZMax.value = "";
    walkabilityDetails.textContent = "No graph loaded";
    showWalkability.checked = false;
    audioDetails.textContent = "Load a map to enable sound";
    audioRoom.textContent = "Room: —";
    musicLoading = false;
    musicTrack.replaceChildren(new Option("No map music", ""));
    musicStatus.textContent = "No map music";
    for (const control of [
      overviewZMin,
      overviewZMax,
      downloadOverview,
      generateWalkability,
      showWalkability,
      downloadWalkability,
      walkabilityFile,
      clearWalkability,
      enableAudio,
      muteAudio,
      audioVolume,
      playerVolume,
      musicVolume,
      musicTrack,
      playMusic,
      stopMusic,
    ]) {
      control.disabled = true;
    }
    window.dispatchEvent(new Event("tea-maps-viewer-reset"));
  }

  element.addEventListener("ready", (event) => {
    const runtime = element.viewer;
    if (!runtime) return;
    if (initialCamera) runtime.setCamera(initialCamera);
    details.textContent = formatMapDetails(
      event.detail.diagnostics,
      event.detail.world.entities.length,
    );
    const support = analyzeEntitySupport(event.detail.world);
    entityCounts.textContent =
      `${support.counts.supported.toLocaleString()} supported · ` +
      `${support.counts.partial.toLocaleString()} partial · ` +
      `${support.counts.baked.toLocaleString()} baked · ` +
      `${support.counts.skipped.toLocaleString()} skipped`;
    const incomplete = support.classes.filter(
      ({ kind }) => kind === "partial" || kind === "skipped",
    );
    entityClasses.replaceChildren(
      ...incomplete.map(({ classname, count, kind, reason }) => {
        const item = document.createElement("li");
        item.textContent = `${classname} × ${count} (${kind}): ${reason}`;
        return item;
      }),
    );
    if (incomplete.length === 0) {
      const item = document.createElement("li");
      item.textContent = "No partial or skipped entity classes";
      entityClasses.append(item);
    }
    warningMessages = [...event.detail.diagnostics.warnings];
    warnings.textContent = warningMessages.slice(0, 5).join("\n");
    const overview = planOverview(event.detail.world);
    overviewZMin.value = String(Math.floor(overview.bounds.min[2]));
    overviewZMax.value = String(Math.ceil(overview.bounds.max[2]));
    overviewStatus.textContent = "Ready to export";
    for (const control of [
      overviewZMin,
      overviewZMax,
      downloadOverview,
      generateWalkability,
      walkabilityFile,
      enableAudio,
      muteAudio,
      audioVolume,
      playerVolume,
      musicVolume,
    ]) {
      control.disabled = false;
    }
    const tracks = event.detail.world.musicTracks;
    musicTrack.replaceChildren(
      ...(tracks.length === 0
        ? [new Option("No map music", "")]
        : tracks.map(
            (track) =>
              new Option(
                `${track.reference.basename}${track.targetName ? ` · ${track.targetName}` : ""}`,
                String(track.entityIndex),
              ),
          )),
    );
    musicTrack.disabled = tracks.length === 0;
    updateWalkability();
    updateAudio();
  });
  element.addEventListener("warning", (event) => {
    warningMessages.push(event.detail.message);
    warnings.textContent = warningMessages.slice(-5).join("\n");
    if (event.detail.code === "asset-warning")
      toolStatus.textContent = event.detail.message;
  });
  element.addEventListener("walkabilitychange", (event) => {
    updateWalkability();
    if (event.detail.walkability)
      toolStatus.textContent = "Walkability graph ready";
  });
  element.addEventListener("audiochange", updateAudio);
  element.addEventListener("error", (event) => {
    if (!element.viewer?.world) reset();
    report(event.detail.error);
  });

  downloadOverview.addEventListener("click", async () => {
    const runtime = element.viewer;
    if (!runtime?.world) return;
    const zMin = overviewZMin.valueAsNumber;
    const zMax = overviewZMax.valueAsNumber;
    if (!Number.isFinite(zMin) || !Number.isFinite(zMax) || zMin > zMax) {
      overviewStatus.textContent = "Lower height must not exceed upper height";
      return;
    }
    downloadOverview.disabled = true;
    overviewStatus.textContent = "Rendering overview";
    try {
      const [width, height = width] = overviewSize.value.split("x").map(Number);
      const options: OverviewCaptureOptions = {
        width,
        height,
        lighting:
          overviewLighting.value === "fullbright"
            ? "fullbright"
            : "lightmapped",
        rotation:
          overviewRotation.value === "auto"
            ? "auto"
            : overviewRotation.value === "90"
              ? 90
              : 0,
        zMin,
        zMax,
        cutaway: overviewCutaway.checked ? "auto" : "none",
        background: overviewTransparent.checked
          ? "transparent"
          : [0.025, 0.035, 0.03, 1],
      };
      const result = await runtime.captureOverview(options);
      if (element.viewer !== runtime) return;
      download(result.image, `${safeMapName()}-overview.png`);
      overviewStatus.textContent = `${result.layout.width} × ${result.layout.height}, ${result.layout.rotation}°${overviewCutaway.checked && runtime.walkability ? " · cutaway" : ""}`;
    } catch (error) {
      overviewStatus.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      downloadOverview.disabled = !element.viewer?.world;
    }
  });
  generateWalkability.addEventListener("click", async () => {
    const runtime = element.viewer;
    if (!runtime?.world) return;
    const sampleSpacing = Number(spacing.value);
    if (
      !Number.isFinite(sampleSpacing) ||
      sampleSpacing < 8 ||
      sampleSpacing > 128
    ) {
      toolStatus.textContent = "Spacing must be between 8 and 128";
      return;
    }
    generateWalkability.disabled = true;
    toolStatus.textContent = "Generating walkability graph";
    try {
      const graph = await runtime.generateWalkability({
        spacing: sampleSpacing,
        allowJump: probeJumps.checked,
        onProgress(progress) {
          if (element.viewer === runtime)
            toolStatus.textContent = `Sampling ${progress.nodes.toLocaleString()} nodes`;
        },
      });
      if (element.viewer !== runtime) return;
      runtime.setWalkability(graph);
      element.walkabilityVisible = true;
      toolStatus.textContent = "Walkability graph ready";
    } catch (error) {
      report(error);
    } finally {
      generateWalkability.disabled = !element.viewer?.world;
    }
  });
  showWalkability.addEventListener("change", () => {
    element.walkabilityVisible = showWalkability.checked;
  });
  downloadWalkability.addEventListener("click", () => {
    const graph = element.viewer?.walkability;
    if (!graph) return;
    download(
      new Blob([serializeWalkability(graph)], { type: "application/json" }),
      `${safeMapName()}.tea-maps-walkability.json`,
    );
    toolStatus.textContent = "Walkability sidecar downloaded";
  });
  walkabilityFile.addEventListener("change", () => {
    const file = walkabilityFile.files?.[0];
    if (!file) return;
    element.walkabilitySource = file;
    toolStatus.textContent = "Loading walkability sidecar";
  });
  clearWalkability.addEventListener("click", () => {
    element.walkabilitySource = null;
    element.viewer?.setWalkability(null);
    toolStatus.textContent = "Walkability graph cleared";
  });
  enableAudio.addEventListener("click", async () => {
    try {
      await element.viewer?.enableAudio();
    } catch (error) {
      report(error);
    }
  });
  muteAudio.addEventListener("change", () => {
    element.viewer?.setAudioMuted(muteAudio.checked);
  });
  audioVolume.addEventListener("input", () => {
    element.viewer?.setAudioVolume(Number(audioVolume.value));
  });
  playerVolume.addEventListener("input", () => {
    element.viewer?.setPlayerAudioVolume(Number(playerVolume.value));
  });
  musicVolume.addEventListener("input", () => {
    element.viewer?.setMusicVolume(Number(musicVolume.value));
  });
  playMusic.addEventListener("click", async () => {
    const runtime = element.viewer;
    if (!runtime?.world || musicTrack.disabled || musicLoading) return;
    musicLoading = true;
    playMusic.disabled = true;
    musicStatus.textContent = "Starting music";
    try {
      await runtime.playMusic(Number(musicTrack.value));
    } catch (error) {
      if (element.viewer === runtime) report(error);
    } finally {
      if (element.viewer === runtime) {
        musicLoading = false;
        updateAudio();
      }
    }
  });
  stopMusic.addEventListener("click", () => {
    element.viewer?.stopMusic();
  });

  return {
    reset,
    setInitialCamera(camera) {
      initialCamera = camera;
    },
  };
}
