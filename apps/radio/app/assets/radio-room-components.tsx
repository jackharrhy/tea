import { on, ref, type Handle } from "remix/component";

import type { Track } from "../data/protocol.ts";
import { RadioHeader, RadioStatus } from "../ui/radio-header.tsx";
import {
  fitFontSize,
  fitText,
  getMaxTitleFontSize,
  getTextSurfaces,
  normalizeText,
} from "./pretext-fit.ts";
import {
  AudioVisualizer,
  AudioVisualizerPreview,
} from "./audio-visualizer.tsx";
import type { RadioClient, RadioClientState } from "./radio-client.ts";
import { radioStyle } from "./radio-room-styles.ts";

export function RadioPlayerView(
  handle: Handle<{
    state: RadioClientState;
    client: RadioClient | null;
    preview?: boolean;
    roomName?: string;
    viewportWidth: number;
    onTrackInput?: (node: HTMLInputElement, signal: AbortSignal) => void;
    onUploadSelected?: (input: HTMLInputElement) => void;
    onAddTrack?: () => void;
  }>,
) {
  let scrubPosition: number | null = null;
  let pendingSeek: number | null = null;
  let pointerScrubbing = false;
  let scrubTrackId = handle.props.state.currentTrackId;

  function stageSeek(position: number): void {
    scrubPosition = position;
    pendingSeek = position;
    handle.update();
  }

  function commitSeek(): void {
    if (pendingSeek === null) return;
    let position = pendingSeek;
    pendingSeek = null;
    scrubPosition = null;
    handle.props.client?.seek(position);
    handle.update();
  }

  function getPointerPosition(
    event: PointerEvent & { currentTarget: HTMLInputElement },
  ): number {
    let bounds = event.currentTarget.getBoundingClientRect();
    let ratio =
      bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0;
    let duration = handle.props.state.durationSeconds;
    let position = Math.max(0, Math.min(1, ratio)) * duration;
    return Math.round(position * 10) / 10;
  }

  return () => {
    let { state, client, preview = false, viewportWidth } = handle.props;
    if (scrubTrackId !== state.currentTrackId) {
      scrubTrackId = state.currentTrackId;
      scrubPosition = null;
      pendingSeek = null;
    }

    let currentTrack =
      state.tracks.find((track) => track.id === state.currentTrackId) ?? null;
    let surface = getTextSurfaces(viewportWidth);
    let currentTrackTitle = normalizeText(currentTrack?.title ?? "");
    let displayedPosition = scrubPosition ?? state.positionSeconds;
    let playbackOffsetMs = -state.deviceCompensationMs;

    return (
      <section
        data-radio-shell=""
        mix={[
          radioStyle.window,
          radioStyle.shell,
          preview ? radioStyle.previewShell : radioStyle.pageShell,
        ]}
      >
        <RadioHeader
          roomName={handle.props.roomName}
          status={<StatusPill state={state} />}
        />

        <section
          mix={[radioStyle.panel, radioStyle.nowPlaying]}
          aria-busy={isLoading(state)}
          data-empty={currentTrack === null ? "true" : "false"}
          aria-label={currentTrack?.title ?? "Nothing playing"}
        >
          {!preview && client ? (
            <AudioVisualizer
              client={client}
              playing={state.playing}
              positionSeconds={state.positionSeconds}
            />
          ) : (
            <AudioVisualizerPreview
              hasTrack={currentTrack !== null}
              playing={state.playing}
            />
          )}
          <div mix={radioStyle.trackMeta}>
            {currentTrack ? (
              <FittedTitle
                text={currentTrackTitle}
                title={currentTrack.title}
                fallbackWidth={surface.nowPlaying}
              />
            ) : null}
          </div>
        </section>

        <div mix={radioStyle.content}>
          <section mix={[radioStyle.panel, radioStyle.queuePanel]}>
            <div mix={radioStyle.sectionHeader}>
              <h2>playlist</h2>
              <input
                mix={[
                  radioStyle.fileInput,
                  ref((node, signal) =>
                    handle.props.onTrackInput?.(node, signal),
                  ),
                  on("change", (event) =>
                    handle.props.onUploadSelected?.(event.currentTarget),
                  ),
                ]}
                hidden={true}
                name="track"
                type="file"
                accept="audio/*,video/webm"
              />
              <button
                aria-label="Add track"
                mix={[
                  radioStyle.smallPrimaryButton,
                  on("click", (event) => {
                    event.preventDefault();
                    handle.props.onAddTrack?.();
                  }),
                ]}
                type="button"
              >
                upload track
              </button>
            </div>
            <div mix={radioStyle.queueScroll}>
              <TrackList
                state={state}
                client={client}
                surface={surface.queueTrack}
              />
            </div>
          </section>

          <aside mix={[radioStyle.panel, radioStyle.listeners]}>
            <h2 mix={radioStyle.utilityTitle}>listeners</h2>
            <ul mix={radioStyle.list}>
              {state.clients.map((person) => (
                <li key={person.clientId} mix={radioStyle.person}>
                  <span>{person.name}</span>
                  <small>
                    {person.rtt ? `${Math.round(person.rtt)}ms` : "sync"}
                  </small>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        <footer mix={radioStyle.controlBar}>
          <div mix={radioStyle.transport}>
            <button
              mix={[
                radioStyle.playToggle,
                on("click", () =>
                  state.playing ? client?.pause() : client?.play(),
                ),
              ]}
              type="button"
              disabled={!state.tracks.some((track) => !track.upload)}
              aria-label={state.playing ? "Pause" : "Play"}
              title={state.playing ? "Pause" : "Play"}
            >
              {state.playing ? "Pause" : "Play"}
            </button>
            <button
              mix={[
                radioStyle.iconButton,
                on("click", () => void client?.wakeAudio()),
              ]}
              type="button"
              aria-label="Wake audio"
              title="Wake audio"
            >
              Wake
            </button>
            <button
              mix={[
                radioStyle.iconButton,
                on("click", () => client?.syncNow()),
              ]}
              type="button"
              disabled={!state.connected}
              aria-label="Sync playback"
              title="Sync playback"
            >
              Sync
            </button>
            <div mix={radioStyle.nudgeControls}>
              <button
                mix={[
                  radioStyle.nudgeButton,
                  on("click", () =>
                    client?.setDeviceCompensation(
                      state.deviceCompensationMs + 10,
                    ),
                  ),
                ]}
                type="button"
                aria-label="Play 10 milliseconds earlier"
                title="Play 10 milliseconds earlier"
              >
                −10ms
              </button>
              <output
                aria-hidden={playbackOffsetMs === 0}
                aria-label={
                  playbackOffsetMs === 0
                    ? undefined
                    : `Playback offset: ${Math.abs(playbackOffsetMs)} milliseconds ${playbackOffsetMs < 0 ? "earlier" : "later"}`
                }
                aria-live="polite"
                data-zero={playbackOffsetMs === 0 ? "true" : "false"}
                mix={radioStyle.nudgeOffset}
              >
                {playbackOffsetMs === 0
                  ? "0ms"
                  : playbackOffsetMs < 0
                    ? "−"
                    : "+"}
                {playbackOffsetMs === 0
                  ? null
                  : `${Math.abs(playbackOffsetMs)}ms`}
              </output>
              <button
                mix={[
                  radioStyle.nudgeButton,
                  on("click", () =>
                    client?.setDeviceCompensation(
                      state.deviceCompensationMs - 10,
                    ),
                  ),
                ]}
                type="button"
                aria-label="Play 10 milliseconds later"
                title="Play 10 milliseconds later"
              >
                +10ms
              </button>
            </div>
          </div>
          <label mix={radioStyle.seek}>
            <span>{formatTime(displayedPosition)}</span>
            <input
              aria-label="Track position"
              key={`${state.currentTrackId ?? "empty"}:${state.durationSeconds > 0 ? "ready" : "loading"}`}
              type="range"
              min="0"
              max={String(Math.max(0, state.durationSeconds))}
              step="0.1"
              value={String(
                Math.min(
                  displayedPosition,
                  state.durationSeconds || displayedPosition,
                ),
              )}
              disabled={!state.currentTrackId || state.durationSeconds <= 0}
              mix={[
                on("input", (event) =>
                  stageSeek(event.currentTarget.valueAsNumber),
                ),
                on("change", commitSeek),
                on("pointerdown", (event) => {
                  if (event.currentTarget.disabled) return;
                  event.preventDefault();
                  pointerScrubbing = true;
                  event.currentTarget.focus();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  stageSeek(getPointerPosition(event));
                }),
                on("pointermove", (event) => {
                  if (!pointerScrubbing) return;
                  event.preventDefault();
                  stageSeek(getPointerPosition(event));
                }),
                on("pointerup", (event) => {
                  if (!pointerScrubbing) return;
                  event.preventDefault();
                  stageSeek(getPointerPosition(event));
                  pointerScrubbing = false;
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  commitSeek();
                }),
                on("pointercancel", () => {
                  pointerScrubbing = false;
                  scrubPosition = null;
                  pendingSeek = null;
                  handle.update();
                }),
                on("keyup", commitSeek),
                on("blur", commitSeek),
              ]}
            />
            <span>
              {state.durationSeconds > 0
                ? formatTime(state.durationSeconds)
                : "--:--"}
            </span>
          </label>
          <label mix={radioStyle.volume}>
            <span>vol</span>
            <input
              aria-label="Volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={String(state.volume)}
              mix={on("input", (event) =>
                client?.setVolume(event.currentTarget.valueAsNumber),
              )}
            />
            <span>{Math.round(state.volume * 100)}</span>
          </label>
        </footer>
      </section>
    );
  };
}

function FittedTitle(
  handle: Handle<{ text: string; title?: string; fallbackWidth: number }>,
) {
  let width = handle.props.fallbackWidth;

  function updateWidth(nextWidth: number): void {
    let roundedWidth = Math.max(0, Math.floor(nextWidth));
    if (Math.abs(width - roundedWidth) < 2) return;
    width = roundedWidth;
    handle.update();
  }

  return () => {
    let surfaceWidth = width || handle.props.fallbackWidth;
    let fontSize = fitFontSize(
      handle.props.text,
      surfaceWidth,
      getMaxTitleFontSize(surfaceWidth),
      6,
    );

    return (
      <h1
        mix={[
          radioStyle.trackTitle,
          ref((node, signal) => {
            updateWidth(node.getBoundingClientRect().width);

            let observer = new ResizeObserver((entries) => {
              updateWidth(entries[0]?.contentRect.width ?? 0);
            });
            observer.observe(node);
            signal.addEventListener("abort", () => observer.disconnect());
          }),
        ]}
        title={handle.props.title}
        style={{ fontSize: `${fontSize}px`, lineHeight: `${fontSize}px` }}
      >
        {handle.props.text}
      </h1>
    );
  };
}

function getDropPosition(
  event: DragEvent & { currentTarget: HTMLElement },
): "before" | "after" {
  let bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

function getDropOrder(
  trackIds: string[],
  sourceId: string,
  targetId: string,
  position: "before" | "after",
): string[] {
  if (sourceId === targetId) return trackIds;
  let nextOrder = trackIds.filter((trackId) => trackId !== sourceId);
  let targetIndex = nextOrder.indexOf(targetId);
  if (targetIndex === -1 || !trackIds.includes(sourceId)) return trackIds;
  nextOrder.splice(targetIndex + (position === "after" ? 1 : 0), 0, sourceId);
  return nextOrder;
}

function ordersMatch(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((trackId, index) => trackId === right[index])
  );
}

export function TrackList(
  handle: Handle<{
    state: RadioClientState;
    client: RadioClient | null;
    surface: number;
  }>,
) {
  let editingTrackId: string | null = null;
  let draftTitle = "";
  let draggingTrackId: string | null = null;
  let dropTargetId: string | null = null;
  let dropPosition: "before" | "after" | null = null;

  function beginRename(track: Track): void {
    if (track.upload) return;
    editingTrackId = track.id;
    draftTitle = track.title;
    handle.update();
  }

  function cancelRename(): void {
    editingTrackId = null;
    draftTitle = "";
    handle.update();
  }

  function commitRename(track: Track): void {
    if (editingTrackId !== track.id) return;
    let nextTitle = draftTitle.trim();
    editingTrackId = null;
    draftTitle = "";
    if (nextTitle && nextTitle !== track.title) {
      handle.props.client?.renameTrack(track.id, nextTitle);
    }
    handle.update();
  }

  function getQueueNextOrder(trackId: string): string[] {
    let trackIds = handle.props.state.tracks.map((track) => track.id);
    if (
      !trackIds.includes(trackId) ||
      trackId === handle.props.state.currentTrackId
    ) {
      return trackIds;
    }

    let nextOrder = trackIds.filter((candidateId) => candidateId !== trackId);
    let currentIndex = handle.props.state.currentTrackId
      ? nextOrder.indexOf(handle.props.state.currentTrackId)
      : -1;
    nextOrder.splice(currentIndex + 1, 0, trackId);
    return nextOrder;
  }

  function canQueueNext(track: Track): boolean {
    if (track.upload) return false;
    let currentOrder = handle.props.state.tracks.map(
      (candidate) => candidate.id,
    );
    return !ordersMatch(currentOrder, getQueueNextOrder(track.id));
  }

  function queueNext(track: Track): void {
    let nextOrder = getQueueNextOrder(track.id);
    let currentOrder = handle.props.state.tracks.map(
      (candidate) => candidate.id,
    );
    if (!ordersMatch(currentOrder, nextOrder))
      handle.props.client?.reorderTracks(nextOrder);
  }

  function stageDropTarget(
    track: Track,
    event: DragEvent & { currentTarget: HTMLElement },
  ): void {
    if (!draggingTrackId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

    if (draggingTrackId === track.id) {
      if (dropTargetId === null) return;
      dropTargetId = null;
      dropPosition = null;
      handle.update();
      return;
    }

    let nextPosition = getDropPosition(event);
    if (dropTargetId === track.id && dropPosition === nextPosition) return;
    dropTargetId = track.id;
    dropPosition = nextPosition;
    handle.update();
  }

  function finishDrag(): void {
    if (!draggingTrackId && !dropTargetId && !dropPosition) return;
    draggingTrackId = null;
    dropTargetId = null;
    dropPosition = null;
    handle.update();
  }

  function commitDrop(
    track: Track,
    event: DragEvent & { currentTarget: HTMLElement },
  ): void {
    if (!draggingTrackId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

    let currentOrder = handle.props.state.tracks.map(
      (candidate) => candidate.id,
    );
    let nextOrder = getDropOrder(
      currentOrder,
      draggingTrackId,
      track.id,
      getDropPosition(event),
    );
    draggingTrackId = null;
    dropTargetId = null;
    dropPosition = null;
    if (!ordersMatch(currentOrder, nextOrder))
      handle.props.client?.reorderTracks(nextOrder);
    handle.update();
  }

  function moveTrack(
    trackId: string,
    destination: "up" | "down" | "first" | "last",
  ): void {
    let nextOrder = handle.props.state.tracks.map((track) => track.id);
    let sourceIndex = nextOrder.indexOf(trackId);
    if (sourceIndex === -1) return;
    let targetIndex =
      destination === "first"
        ? 0
        : destination === "last"
          ? nextOrder.length - 1
          : sourceIndex + (destination === "up" ? -1 : 1);
    targetIndex = Math.max(0, Math.min(nextOrder.length - 1, targetIndex));
    if (targetIndex === sourceIndex) return;
    nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, trackId);
    handle.props.client?.reorderTracks(nextOrder);
  }

  return () => {
    let { state } = handle.props;
    if (state.tracks.length === 0) {
      return null;
    }

    return (
      <ol mix={radioStyle.queueList}>
        {state.tracks.map((track, index) => {
          let active = track.id === state.currentTrackId;
          let uploadPercent = track.upload
            ? Math.round(
                (track.upload.bytesReceived / track.upload.sizeBytes) * 100,
              )
            : null;
          let distribution =
            state.bufferingTrackId === track.id && state.totalClientCount > 0
              ? `${state.readyClientCount}/${state.totalClientCount} ready`
              : null;
          let status = track.upload
            ? track.upload.status === "failed"
              ? "failed"
              : `↑ ${uploadPercent}%`
            : distribution;
          return (
            <li
              key={track.id}
              mix={[
                radioStyle.queueItem,
                active ? radioStyle.activeQueueItem : null,
                on("dragover", (event) => stageDropTarget(track, event)),
                on("drop", (event) => commitDrop(track, event)),
              ]}
              data-dragging={draggingTrackId === track.id ? "true" : undefined}
              data-drop-position={
                dropTargetId === track.id ? dropPosition : undefined
              }
              data-upload-status={track.upload?.status}
            >
              {track.upload?.status === "uploading" ? (
                <span
                  aria-hidden="true"
                  mix={radioStyle.trackProgress}
                  style={{ width: `${uploadPercent}%` }}
                />
              ) : null}
              <button
                aria-label={`Reorder ${track.title}`}
                aria-keyshortcuts="ArrowUp ArrowDown Home End"
                draggable={true}
                mix={[
                  radioStyle.dragHandle,
                  on("dragstart", (event) => {
                    draggingTrackId = track.id;
                    dropTargetId = null;
                    dropPosition = null;
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", track.id);
                    }
                    handle.update();
                  }),
                  on("dragend", finishDrag),
                  on("keydown", (event) => {
                    let destination: "up" | "down" | "first" | "last" | null =
                      event.key === "ArrowUp"
                        ? "up"
                        : event.key === "ArrowDown"
                          ? "down"
                          : event.key === "Home"
                            ? "first"
                            : event.key === "End"
                              ? "last"
                              : null;
                    if (!destination) return;
                    event.preventDefault();
                    moveTrack(track.id, destination);
                  }),
                ]}
                title={`Drag to reorder ${track.title}`}
                type="button"
              >
                Reorder
              </button>
              <button
                type="button"
                mix={[
                  radioStyle.trackButton,
                  editingTrackId === track.id
                    ? radioStyle.editingTrackButton
                    : null,
                  on("click", () => handle.props.client?.play(track.id)),
                ]}
                disabled={Boolean(track.upload)}
                tabIndex={editingTrackId === track.id ? -1 : undefined}
              >
                <span mix={radioStyle.queueIndex}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span mix={radioStyle.queueTrack} title={track.title}>
                  <span>{fitText(track.title, handle.props.surface, 1)}</span>
                  {status ? <small>{status}</small> : null}
                </span>
              </button>
              {editingTrackId === track.id ? (
                <input
                  aria-label={`Rename ${track.title}`}
                  mix={[
                    radioStyle.input,
                    radioStyle.queueEditInput,
                    on("input", (event) => {
                      draftTitle = event.currentTarget.value;
                    }),
                    on("keydown", (event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitRename(track);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }),
                    on("blur", () => commitRename(track)),
                  ]}
                  value={draftTitle}
                  autofocus={true}
                />
              ) : null}
              <details mix={radioStyle.trackMenuDetails}>
                <summary
                  mix={radioStyle.trackMenuButton}
                  aria-label={`Actions for ${track.title}`}
                  title={`Actions for ${track.title}`}
                >
                  <span aria-hidden="true" mix={radioStyle.trackMenuGlyph}>
                    more_vert
                  </span>
                </summary>
                <div mix={radioStyle.trackMenuPopover}>
                  <div mix={radioStyle.trackMenuList}>
                    <button
                      type="button"
                      aria-label="queue next"
                      mix={[
                        radioStyle.trackMenuItem,
                        on("click", (event) => {
                          event.currentTarget.closest("details")!.open = false;
                          queueNext(track);
                        }),
                      ]}
                      disabled={!canQueueNext(track)}
                    >
                      <span
                        aria-hidden="true"
                        mix={radioStyle.trackMenuItemIcon}
                      >
                        playlist_play
                      </span>
                      <span>queue next</span>
                    </button>
                    <button
                      type="button"
                      aria-label="rename"
                      mix={[
                        radioStyle.trackMenuItem,
                        on("click", (event) => {
                          event.currentTarget.closest("details")!.open = false;
                          beginRename(track);
                        }),
                      ]}
                      disabled={
                        Boolean(track.upload) || editingTrackId === track.id
                      }
                    >
                      <span
                        aria-hidden="true"
                        mix={radioStyle.trackMenuItemIcon}
                      >
                        edit
                      </span>
                      <span>rename</span>
                    </button>
                    <button
                      type="button"
                      aria-label="delete"
                      mix={[
                        radioStyle.trackMenuItem,
                        on("click", (event) => {
                          event.currentTarget.closest("details")!.open = false;
                          handle.props.client?.removeTrack(track.id);
                        }),
                      ]}
                    >
                      <span
                        aria-hidden="true"
                        mix={radioStyle.trackMenuItemIcon}
                      >
                        close
                      </span>
                      <span>delete</span>
                    </button>
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    );
  };
}

export function StatusPill(handle: Handle<{ state: RadioClientState }>) {
  return () => {
    let state = handle.props.state;
    let connection = state.connected ? "online" : "offline";
    let synchronization = state.synced ? "synced" : "syncing";
    let latency = `${Math.round(state.rttMs)}ms`;
    let uncertainty = Number.isFinite(state.syncUncertaintyMs)
      ? `±${Math.round(state.syncUncertaintyMs)}ms`
      : "measuring";
    let quality = `${uncertainty} / ${Math.round(state.clockSkewPpm)}ppm / ${Math.round(state.playbackErrorMs)}ms error`;
    let details = state.connected
      ? `${connection} / ${synchronization} / ${latency} / ${quality}`
      : `${connection} / ${synchronization}`;
    let tone: "offline" | "online" | "syncing" = !state.connected
      ? "offline"
      : state.synced
        ? "online"
        : "syncing";

    return (
      <RadioStatus label={details} tone={tone}>
        <span>{connection}</span>
        <i>/</i>
        <span>{synchronization}</span>
        {state.connected ? (
          <>
            <i>/</i>
            <span>{latency}</span>
          </>
        ) : null}
      </RadioStatus>
    );
  };
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  let totalSeconds = Math.floor(seconds);
  let minutes = Math.floor(totalSeconds / 60);
  let remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function isLoading(state: RadioClientState): boolean {
  return state.status.toLowerCase().startsWith("buffering");
}
