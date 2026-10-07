import {
  analyzeEntitySupport,
  type CameraState,
  type MapDiagnostics,
} from "@tea/maps-renderer";
import type { WorldViewElement } from "@tea/maps-renderer/element";

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
  const details = document.querySelector<HTMLOutputElement>("#map-details")!;
  const warnings = document.querySelector<HTMLOutputElement>("#map-warnings")!;
  const entityCounts =
    document.querySelector<HTMLOutputElement>("#entity-counts")!;
  const entityClasses =
    document.querySelector<HTMLUListElement>("#entity-classes")!;
  const toolStatus =
    document.querySelector<HTMLOutputElement>("#map-tool-status")!;
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
    audioDetails.textContent = "Load a map to enable sound";
    audioRoom.textContent = "Room: —";
    musicLoading = false;
    musicTrack.replaceChildren(new Option("No map music", ""));
    musicStatus.textContent = "No map music";
    for (const control of [
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
    for (const control of [
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
    updateAudio();
  });
  element.addEventListener("warning", (event) => {
    warningMessages.push(event.detail.message);
    warnings.textContent = warningMessages.slice(-5).join("\n");
    if (event.detail.code === "asset-warning")
      toolStatus.textContent = event.detail.message;
  });
  element.addEventListener("audiochange", updateAudio);
  element.addEventListener("error", (event) => {
    if (!element.viewer?.world) reset();
    report(event.detail.error);
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
