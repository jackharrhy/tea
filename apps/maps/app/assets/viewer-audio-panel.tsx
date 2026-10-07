import type { AudioState, WorldviewViewer } from "@tea/maps-renderer";
import type { WorldViewElement } from "@tea/maps-renderer/element";
import { clientEntry, on, type Handle } from "remix/component";

type MusicTrack = NonNullable<WorldviewViewer["world"]>["musicTracks"][number];

export const ViewerAudioPanel = clientEntry(
  `${import.meta.url}#ViewerAudioPanel`,
  function ViewerAudioPanelComponent(handle: Handle) {
    let element: WorldViewElement | null = null;
    let ready = false;
    let generation = 0;
    let audio: AudioState | null = null;
    let tracks: readonly MusicTrack[] = [];
    let selectedTrack = "";
    let musicLoading = false;
    let status = "";

    function updateAudio(next: AudioState) {
      audio = { ...next };
      if (next.musicEntityIndex !== null)
        selectedTrack = String(next.musicEntityIndex);
      handle.update();
    }

    function mapReady() {
      const runtime = element?.viewer;
      if (!runtime?.world) return;
      generation += 1;
      ready = true;
      musicLoading = false;
      status = "";
      tracks = runtime.world.musicTracks;
      selectedTrack = tracks[0] ? String(tracks[0].entityIndex) : "";
      updateAudio(runtime.audio);
    }

    function reset() {
      generation += 1;
      ready = false;
      audio = null;
      tracks = [];
      selectedTrack = "";
      musicLoading = false;
      status = "";
      handle.update();
    }

    handle.queueTask(() => {
      function attach() {
        if (element) return;
        element = document.querySelector<WorldViewElement>(
          "#viewport world-view",
        );
        if (!element) return;
        element.addEventListener("ready", mapReady, { signal: handle.signal });
        element.addEventListener(
          "audiochange",
          (event) => {
            if (ready) updateAudio(event.detail.state);
          },
          { signal: handle.signal },
        );
        element.addEventListener(
          "error",
          () => {
            if (!element?.viewer?.world) reset();
          },
          { signal: handle.signal },
        );
        if (element.viewer?.world) mapReady();
      }
      window.addEventListener("tea-maps-viewer-element-ready", attach, {
        signal: handle.signal,
      });
      window.addEventListener("tea-maps-viewer-reset", reset, {
        signal: handle.signal,
      });
      attach();
    });

    async function enableSound() {
      const runtime = element?.viewer;
      if (!runtime?.world) return;
      const currentGeneration = generation;
      status = "";
      handle.update();
      try {
        await runtime.enableAudio();
        if (generation === currentGeneration && element?.viewer === runtime)
          updateAudio(runtime.audio);
      } catch (error) {
        if (generation !== currentGeneration || element?.viewer !== runtime)
          return;
        status = error instanceof Error ? error.message : String(error);
        handle.update();
      }
    }

    async function startMusic() {
      const runtime = element?.viewer;
      if (!runtime?.world || !selectedTrack || musicLoading) return;
      const currentGeneration = generation;
      musicLoading = true;
      status = "";
      handle.update();
      try {
        await runtime.playMusic(Number(selectedTrack));
      } catch (error) {
        if (generation !== currentGeneration || element?.viewer !== runtime)
          return;
        status = error instanceof Error ? error.message : String(error);
      } finally {
        if (generation === currentGeneration && element?.viewer === runtime) {
          musicLoading = false;
          updateAudio(runtime.audio);
        }
      }
    }

    function changeVolume(
      key: "volume" | "playerVolume" | "musicVolume",
      value: number,
    ) {
      const runtime = element?.viewer;
      if (!runtime?.world || !audio || !Number.isFinite(value)) return;
      audio = { ...audio, [key]: value };
      handle.update();
      try {
        if (key === "volume") runtime.setAudioVolume(value);
        else if (key === "playerVolume") runtime.setPlayerAudioVolume(value);
        else runtime.setMusicVolume(value);
      } catch (error) {
        status = error instanceof Error ? error.message : String(error);
        updateAudio(runtime.audio);
      }
    }

    const audioDetails = () =>
      !ready || !audio
        ? "Load a map to enable sound"
        : audio.enabled
          ? audio.suspended
            ? "Sound paused"
            : "Sound enabled"
          : "Sound off";

    const musicStatus = () =>
      tracks.length === 0
        ? "No map music"
        : musicLoading
          ? "Starting music"
          : audio?.musicPlaying
            ? "Playing"
            : "Stopped";

    return () => (
      <section aria-label="Map audio">
        <h2>Audio</h2>
        <output id="audio-details">{audioDetails()}</output>
        <output id="audio-room" class="hint">
          {`Room: ${ready && audio ? (audio.roomType === 0 ? "0 · off" : audio.roomType) : "—"}`}
        </output>
        <button
          id="enable-audio"
          type="button"
          disabled={!ready}
          mix={on("click", () => void enableSound())}
        >
          Enable sound
        </button>
        <label class="toggle" for="mute-audio">
          <input
            id="mute-audio"
            type="checkbox"
            checked={audio?.muted ?? false}
            disabled={!ready}
            mix={on<HTMLInputElement>("change", (event) => {
              const runtime = element?.viewer;
              if (!runtime?.world || !audio) return;
              const muted = event.currentTarget.checked;
              audio = { ...audio, muted };
              handle.update();
              try {
                runtime.setAudioMuted(muted);
              } catch (error) {
                status = error instanceof Error ? error.message : String(error);
                updateAudio(runtime.audio);
              }
            })}
          />
          Mute
        </label>
        <label for="audio-volume">Volume</label>
        <input
          id="audio-volume"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={String(audio?.volume ?? 0.8)}
          disabled={!ready}
          mix={on<HTMLInputElement>("input", (event) =>
            changeVolume("volume", event.currentTarget.valueAsNumber),
          )}
        />
        <label for="player-volume">Footstep volume</label>
        <input
          id="player-volume"
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={String(audio?.playerVolume ?? 1)}
          disabled={!ready}
          mix={on<HTMLInputElement>("input", (event) =>
            changeVolume("playerVolume", event.currentTarget.valueAsNumber),
          )}
        />
        <label for="music-volume">Music volume</label>
        <input
          id="music-volume"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={String(audio?.musicVolume ?? 1)}
          disabled={!ready}
          mix={on<HTMLInputElement>("input", (event) =>
            changeVolume("musicVolume", event.currentTarget.valueAsNumber),
          )}
        />
        <label for="music-track">Music track</label>
        <select
          id="music-track"
          value={selectedTrack}
          disabled={!ready || tracks.length === 0}
          mix={on<HTMLSelectElement>("change", (event) => {
            selectedTrack = event.currentTarget.value;
            handle.update();
          })}
        >
          {tracks.length === 0 ? (
            <option value="">No map music</option>
          ) : (
            tracks.map((track) => (
              <option value={String(track.entityIndex)}>
                {track.reference.basename}
                {track.targetName ? ` · ${track.targetName}` : ""}
              </option>
            ))
          )}
        </select>
        <output id="music-status" class="hint">
          {musicStatus()}
        </output>
        <button
          id="play-music"
          type="button"
          disabled={!ready || tracks.length === 0 || musicLoading}
          mix={on("click", () => void startMusic())}
        >
          Play music
        </button>
        <button
          id="stop-music"
          type="button"
          disabled={!ready || !audio?.musicPlaying}
          mix={on("click", () => {
            const runtime = element?.viewer;
            if (!runtime?.world) return;
            runtime.stopMusic();
            updateAudio(runtime.audio);
          })}
        >
          Stop music
        </button>
        <output id="audio-status" role="status">
          {status}
        </output>
      </section>
    );
  },
);
