import {
  NTP_CONSTANTS,
  epochNow,
  parseServerMessage,
  type ClientInfo,
  type RoomSnapshot,
  type ServerMessage,
  type Track,
} from "../data/protocol.ts";
import { audioContextManager } from "./audio-context.ts";
import { sendProbePair } from "./radio-sync.ts";
import { RadioSynchronizer } from "./radio-synchronizer.ts";
import { uploadTrackContent, type UploadProgress } from "./upload-track.ts";
import { getTrackContentUrl, getTrackCreateUrl, getWsUrl } from "./urls.ts";

export interface RadioClientState {
  connected: boolean;
  synced: boolean;
  offsetMs: number;
  rttMs: number;
  clockSkewPpm: number;
  syncUncertaintyMs: number;
  outputLatencyMs: number;
  playbackErrorMs: number;
  playbackRate: number;
  deviceCompensationMs: number;
  tracks: Track[];
  clients: ClientInfo[];
  currentTrackId: string | null;
  bufferingTrackId: string | null;
  readyClientCount: number;
  totalClientCount: number;
  bufferedSeconds: number;
  playing: boolean;
  positionSeconds: number;
  durationSeconds: number;
  volume: number;
  status: string;
}

export const DEFAULT_SYNC_DIAGNOSTICS = {
  clockSkewPpm: 0,
  syncUncertaintyMs: Infinity,
  outputLatencyMs: 0,
  playbackErrorMs: 0,
  playbackRate: 1,
  deviceCompensationMs: 0,
} satisfies Pick<
  RadioClientState,
  | "clockSkewPpm"
  | "syncUncertaintyMs"
  | "outputLatencyMs"
  | "playbackErrorMs"
  | "playbackRate"
  | "deviceCompensationMs"
>;

interface RadioAudioManager {
  resume(): Promise<void>;
  setMasterGain(value: number, rampTime?: number): void;
  connectMediaElement(element: HTMLMediaElement): void;
  muteNow?(): void;
  scheduleAudibleAt?(localEpochTime: number): number;
  scheduleMuteAt?(localEpochTime: number): number;
  outputLatencyMs?(): number;
  getAnalyser?(): AnalyserNode;
}

type UploadContent = (options: {
  url: string;
  file: File;
  signal: AbortSignal;
  onProgress: (progress: UploadProgress) => void;
}) => Promise<Track>;

export class RadioClient extends EventTarget {
  private socket: WebSocket | null = null;
  private synchronizer: RadioSynchronizer;
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private progressTimer: number | null = null;
  private scheduledActionTimer: number | null = null;
  private currentTime = 0;
  private loadedTrackId: string | null = null;
  private loadedTrackUrl: string | null = null;
  private loadAbort: AbortController | null = null;
  private loadPromise: Promise<boolean> | null = null;
  private mediaEvents = new AbortController();
  private uploadControllers = new Set<AbortController>();
  private disposed = false;

  state: RadioClientState;

  private readonly audio: RadioAudioManager;
  private readonly media: HTMLMediaElement;
  private readonly uploadContent: UploadContent;

  constructor(
    private readonly options: {
      initialSnapshot: RoomSnapshot;
      clientId: string;
      audioManager?: RadioAudioManager;
      mediaElement?: HTMLMediaElement;
      uploadContent?: UploadContent;
      deviceCompensationMs?: number;
    },
  ) {
    super();
    this.audio = options.audioManager ?? audioContextManager;
    this.media = options.mediaElement ?? document.createElement("audio");
    this.uploadContent = options.uploadContent ?? uploadTrackContent;
    this.synchronizer = new RadioSynchronizer(options.deviceCompensationMs);
    this.media.preload = "auto";
    this.audio.connectMediaElement(this.media);
    this.bindMediaEvents();
    this.state = {
      connected: false,
      synced: false,
      offsetMs: 0,
      rttMs: 0,
      ...DEFAULT_SYNC_DIAGNOSTICS,
      outputLatencyMs: this.audio.outputLatencyMs?.() ?? 0,
      deviceCompensationMs: this.synchronizer.deviceCompensationMs,
      tracks: options.initialSnapshot.tracks,
      clients: options.initialSnapshot.clients,
      currentTrackId: options.initialSnapshot.playback.trackId,
      bufferingTrackId: null,
      readyClientCount: 0,
      totalClientCount: 0,
      bufferedSeconds: 0,
      playing: options.initialSnapshot.playback.type === "playing",
      positionSeconds: options.initialSnapshot.playback.trackTimeSeconds,
      durationSeconds: 0,
      volume: options.initialSnapshot.volume,
      status: "Idle",
    };
    this.currentTime = options.initialSnapshot.playback.trackTimeSeconds;
    this.audio.setMasterGain(this.state.volume, 0);
  }

  onState(
    listener: (state: RadioClientState) => void,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(
      "state",
      (event) => listener((event as CustomEvent<RadioClientState>).detail),
      options,
    );
  }

  getAnalyser(): AnalyserNode | null {
    return this.audio.getAnalyser?.() ?? null;
  }

  async wakeAudio(): Promise<void> {
    await this.audio.resume();
    this.setStatus("Audio awake");
  }

  connect(): void {
    if (this.disposed) return;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.socket = new WebSocket(getWsUrl(this.options.initialSnapshot.roomId));
    this.socket.addEventListener("open", () => {
      this.setState({ connected: true, status: "Connected" });
      this.send({ type: "JOIN", clientId: this.options.clientId });
      this.startHeartbeat();
    });
    this.socket.addEventListener("message", (event) => {
      let message = parseServerMessage(String(event.data));
      if (message) void this.handleMessage(message);
    });
    this.socket.addEventListener("close", () => {
      this.stopHeartbeat();
      if (this.disposed) return;
      this.setState({
        connected: false,
        synced: false,
        status: "Disconnected. Reconnecting...",
      });
      this.scheduleReconnect();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopHeartbeat();
    this.stopProgressTimer();
    this.clearScheduledAction();
    this.loadAbort?.abort();
    this.mediaEvents.abort();
    for (let controller of this.uploadControllers) controller.abort();
    this.uploadControllers.clear();
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.media.pause();
    this.media.removeAttribute("src");
    this.media.load();
    this.socket?.close();
    this.socket = null;
  }

  play(trackId?: string): void {
    let fallbackTrack = this.state.tracks.find((track) => !track.upload);
    let nextTrackId = trackId ?? this.state.currentTrackId ?? fallbackTrack?.id;
    if (!nextTrackId) return;
    let track = this.state.tracks.find(
      (candidate) => candidate.id === nextTrackId,
    );
    if (track?.upload) {
      this.setStatus(
        track.upload.status === "failed"
          ? "Upload failed"
          : "Track is uploading",
      );
      return;
    }
    let trackTimeSeconds =
      nextTrackId === this.state.currentTrackId
        ? this.getCurrentTrackPosition()
        : 0;
    this.send({ type: "PLAY", trackId: nextTrackId, trackTimeSeconds });
  }

  pause(): void {
    let trackId = this.state.currentTrackId;
    if (!trackId) return;
    this.send({
      type: "PAUSE",
      trackId,
      trackTimeSeconds: this.getCurrentTrackPosition(),
    });
  }

  removeTrack(trackId: string): void {
    this.send({ type: "REMOVE_TRACK", trackId });
  }

  renameTrack(trackId: string, title: string): void {
    let normalizedTitle = title.trim();
    if (!normalizedTitle) return;
    this.send({ type: "RENAME_TRACK", trackId, title: normalizedTitle });
  }

  reorderTracks(trackIds: string[]): void {
    let currentTrackIds = this.state.tracks.map((track) => track.id);
    if (
      trackIds.length !== currentTrackIds.length ||
      new Set(trackIds).size !== trackIds.length ||
      trackIds.some((trackId) => !currentTrackIds.includes(trackId))
    ) {
      return;
    }

    let tracksById = new Map(
      this.state.tracks.map((track) => [track.id, track]),
    );
    this.setState({
      tracks: trackIds.map((trackId) => tracksById.get(trackId)!),
    });
    this.send({ type: "REORDER_TRACKS", trackIds });
  }

  setVolume(volume: number): void {
    this.send({ type: "SET_VOLUME", volume });
  }

  syncNow(): void {
    this.setStatus("Syncing clock...");
    this.sendProbePair();
  }

  setDeviceCompensation(compensationMs: number): void {
    let value = this.synchronizer.setDeviceCompensation(compensationMs);
    localStorage.setItem("radio.deviceCompensationMs", String(value));
    this.setState({ deviceCompensationMs: value });
    this.sendProbePair();
  }

  seek(trackTimeSeconds: number): void {
    let trackId = this.state.currentTrackId;
    if (!trackId) return;
    let boundedTime = this.boundTrackTime(trackTimeSeconds);
    this.currentTime = boundedTime;
    this.setMediaTime(boundedTime);
    this.setState({ positionSeconds: boundedTime });
    if (this.state.playing) {
      this.send({ type: "PLAY", trackId, trackTimeSeconds: boundedTime });
    } else {
      this.send({ type: "PAUSE", trackId, trackTimeSeconds: boundedTime });
    }
  }

  async upload(file: File): Promise<void> {
    this.setStatus(`Uploading ${file.name}...`);
    let controller = new AbortController();
    this.uploadControllers.add(controller);
    let trackId: string | null = null;

    try {
      let roomSlug = this.options.initialSnapshot.roomId;
      let response = await fetch(getTrackCreateUrl(roomSlug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          mediaType: file.type,
          sizeBytes: file.size,
        }),
        signal: controller.signal,
      });
      let body = (await response.json().catch(() => null)) as {
        track?: Track;
        error?: string;
      } | null;
      if (!response.ok || !body?.track) {
        throw new Error(body?.error ?? "Upload failed");
      }

      let pendingTrack = body.track;
      trackId = pendingTrack.id;
      this.mergeTrack(pendingTrack);
      let completedTrack = await this.uploadContent({
        url: getTrackContentUrl(roomSlug, pendingTrack.id),
        file,
        signal: controller.signal,
        onProgress: ({ bytesSent }) =>
          this.updateUploadProgress(pendingTrack.id, bytesSent),
      });
      this.mergeTrack(completedTrack);
      this.setStatus("Upload complete");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (trackId) this.markUploadFailed(trackId);
      this.setStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      this.uploadControllers.delete(controller);
    }
  }

  private async handleMessage(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "ROOM_STATE": {
        let nextTrackId = message.snapshot.playback.trackId;
        let currentTrack = message.snapshot.tracks.find(
          (track) => track.id === nextTrackId,
        );
        let keepsLoadedTrack =
          currentTrack !== undefined &&
          currentTrack.id === this.loadedTrackId &&
          currentTrack.url === this.loadedTrackUrl;
        this.setState({
          tracks: message.snapshot.tracks,
          clients: message.snapshot.clients,
          currentTrackId: nextTrackId,
          playing: message.snapshot.playback.type === "playing",
          positionSeconds: message.snapshot.playback.trackTimeSeconds,
          durationSeconds: keepsLoadedTrack ? this.mediaDuration() : 0,
          volume: message.snapshot.volume,
        });
        this.currentTime = message.snapshot.playback.trackTimeSeconds;
        this.audio.setMasterGain(message.snapshot.volume, 0);
        if (
          currentTrack &&
          !currentTrack.upload &&
          (await this.loadTrack(currentTrack))
        ) {
          this.setMediaTime(message.snapshot.playback.trackTimeSeconds);
        }
        break;
      }
      case "PRESENCE":
        this.setState({ clients: message.clients });
        break;
      case "QUEUE_UPDATED": {
        let currentPosition = this.getCurrentTrackPosition();
        let tracks = this.mergeServerTracks(message.tracks);
        let currentTrack = tracks.find(
          (track) => track.id === this.state.currentTrackId,
        );
        let currentUrlChanged =
          currentTrack &&
          currentTrack.id === this.loadedTrackId &&
          currentTrack.url !== this.loadedTrackUrl;
        this.setState({ tracks });
        if (
          currentTrack &&
          currentUrlChanged &&
          (await this.loadTrack(currentTrack))
        ) {
          this.setMediaTime(currentPosition);
        }
        break;
      }
      case "NTP_RESPONSE": {
        let estimate = this.synchronizer.handleProbe(message);
        if (!estimate) return;
        this.setState({
          synced: this.synchronizer.synchronized,
          offsetMs: estimate.offset,
          rttMs: estimate.roundTrip,
          clockSkewPpm: estimate.skewPpm,
          syncUncertaintyMs: estimate.uncertaintyMs,
        });
        break;
      }
      case "LOAD_TRACK":
        if (await this.loadTrack(message.track)) {
          this.send({ type: "TRACK_READY", trackId: message.track.id });
        }
        break;
      case "TRACK_BUFFERING":
        this.setState({
          bufferingTrackId: message.trackId,
          readyClientCount: message.readyClientCount,
          totalClientCount: message.totalClientCount,
        });
        break;
      case "SCHEDULED_PLAY":
        this.setState({ bufferingTrackId: null });
        await this.schedulePlay(
          message.trackId,
          message.trackTimeSeconds,
          message.serverTimeToExecute,
        );
        break;
      case "SCHEDULED_PAUSE":
        this.schedulePause(
          message.trackId,
          message.trackTimeSeconds,
          message.serverTimeToExecute,
        );
        break;
      case "VOLUME_UPDATED":
        this.setState({ volume: message.volume });
        this.audio.setMasterGain(message.volume, 0.1);
        break;
      case "LIVENESS_PING":
        this.send({ type: "LIVENESS_PONG" });
        this.sendProbePair();
        break;
      case "ERROR":
        this.setStatus(message.message);
        break;
    }
  }

  private async loadTrack(track: Track): Promise<boolean> {
    if (track.upload) return false;
    if (
      this.loadedTrackId === track.id &&
      this.loadedTrackUrl === track.url &&
      this.media.readyState >= 2
    ) {
      if (track.id === this.state.currentTrackId) {
        this.setState({ durationSeconds: this.mediaDuration() });
      }
      return true;
    }
    if (
      this.loadPromise &&
      this.loadedTrackId === track.id &&
      this.loadedTrackUrl === track.url
    ) {
      return this.loadPromise;
    }

    this.loadAbort?.abort();
    let controller = new AbortController();
    this.loadAbort = controller;
    this.loadedTrackId = track.id;
    this.loadedTrackUrl = track.url;
    this.setStatus(`Buffering ${track.title}...`);

    let promise = new Promise<boolean>((resolve) => {
      let settled = false;
      let finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        if (ready) {
          let durationSeconds = this.mediaDuration();
          if (track.id === this.state.currentTrackId)
            this.setState({ durationSeconds });
          this.setStatus(`Ready ${track.title}`);
        } else {
          if (
            this.loadedTrackId === track.id &&
            this.loadedTrackUrl === track.url
          ) {
            this.loadedTrackId = null;
            this.loadedTrackUrl = null;
          }
          this.setStatus(`Could not load ${track.title}`);
        }
        resolve(ready);
        controller.abort();
      };

      this.media.addEventListener(
        "loadedmetadata",
        () => {
          if (track.id === this.state.currentTrackId) {
            this.setState({ durationSeconds: this.mediaDuration() });
          }
        },
        { signal: controller.signal },
      );
      this.media.addEventListener("canplay", () => finish(true), {
        once: true,
        signal: controller.signal,
      });
      this.media.addEventListener("error", () => finish(false), {
        once: true,
        signal: controller.signal,
      });
      controller.signal.addEventListener(
        "abort",
        () => {
          if (settled) return;
          settled = true;
          resolve(false);
        },
        { once: true },
      );
      this.media.src = track.url;
      this.media.load();
    });
    this.loadPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.loadPromise === promise) this.loadPromise = null;
      if (this.loadAbort === controller) this.loadAbort = null;
    }
  }

  private async schedulePlay(
    trackId: string,
    trackTimeSeconds: number,
    targetServerTime: number,
  ): Promise<void> {
    let track = this.state.tracks.find((candidate) => candidate.id === trackId);
    if (!track || !(await this.loadTrack(track))) return;
    await this.audio.resume();

    let boundedOffset = this.boundTrackTime(trackTimeSeconds);
    let localTargetTime =
      this.synchronizer.localExecutionTime(targetServerTime);
    let waitSeconds = Math.max(0, localTargetTime - epochNow()) / 1000;
    this.clearScheduledAction();
    this.currentTime = boundedOffset;
    this.setState({
      currentTrackId: trackId,
      playing: true,
      positionSeconds: boundedOffset,
      durationSeconds: this.mediaDuration(),
      status: `Starting ${track.title}`,
    });
    this.synchronizer.startPlayback(trackId, boundedOffset, targetServerTime);
    this.audio.muteNow?.();
    this.audio.scheduleAudibleAt?.(localTargetTime);

    if (boundedOffset >= waitSeconds && waitSeconds > 0) {
      this.setMediaTime(boundedOffset - waitSeconds);
      await this.startMedia(track);
      return;
    }
    this.setMediaTime(boundedOffset);
    this.runAtLocalTime(localTargetTime, async () => {
      if (this.loadedTrackId !== trackId || this.disposed) return;
      this.setMediaTime(boundedOffset);
      await this.startMedia(track);
    });
  }

  private schedulePause(
    trackId: string,
    trackTimeSeconds: number,
    targetServerTime: number,
  ): void {
    let boundedTime = this.boundTrackTime(trackTimeSeconds);
    let localTargetTime =
      this.synchronizer.localExecutionTime(targetServerTime);
    this.clearScheduledAction();
    this.audio.scheduleMuteAt?.(localTargetTime);
    this.runAtLocalTime(localTargetTime, () => {
      this.media.pause();
      this.media.playbackRate = 1;
      this.synchronizer.stopPlayback();
      this.currentTime = boundedTime;
      this.setState({ currentTrackId: trackId });
      this.setMediaTime(boundedTime);
      this.stopProgressTimer();
      this.setState({
        playing: false,
        positionSeconds: boundedTime,
        status: "Paused",
      });
    });
  }

  private runAtLocalTime(targetLocalTime: number, action: () => void): void {
    let waitMilliseconds = Math.max(0, targetLocalTime - epochNow());
    if (waitMilliseconds <= 4) {
      action();
      return;
    }
    this.scheduledActionTimer = window.setTimeout(() => {
      this.scheduledActionTimer = null;
      action();
    }, waitMilliseconds);
  }

  private async startMedia(track: Track): Promise<void> {
    try {
      await this.media.play();
      this.setStatus(`Playing ${track.title}`);
      this.startProgressTimer();
    } catch {
      this.setState({ playing: false, status: "Wake audio to play" });
    }
  }

  private getCurrentTrackPosition(): number {
    if (
      this.loadedTrackId === this.state.currentTrackId &&
      Number.isFinite(this.media.currentTime)
    ) {
      return this.boundTrackTime(this.media.currentTime);
    }
    return this.currentTime;
  }

  private boundTrackTime(trackTimeSeconds: number): number {
    let duration = this.mediaDuration() || this.state.durationSeconds;
    let maxTime = duration > 0 ? Math.max(0, duration - 0.01) : Infinity;
    return Math.max(0, Math.min(trackTimeSeconds, maxTime));
  }

  private setMediaTime(value: number): void {
    if (
      this.loadedTrackId !== this.state.currentTrackId &&
      this.state.currentTrackId !== null
    )
      return;
    try {
      this.media.currentTime = value;
    } catch {
      // Metadata may not be available yet; the scheduled start retries this assignment.
    }
  }

  private mediaDuration(): number {
    return Number.isFinite(this.media.duration) && this.media.duration > 0
      ? this.media.duration
      : 0;
  }

  private bindMediaEvents(): void {
    let signal = this.mediaEvents.signal;
    this.media.addEventListener(
      "ended",
      () => {
        let trackId = this.state.currentTrackId;
        if (!trackId || !this.state.playing || this.loadedTrackId !== trackId)
          return;
        let position = this.mediaDuration() || this.media.currentTime;
        this.currentTime = position;
        this.stopProgressTimer();
        this.setState({
          playing: false,
          positionSeconds: position,
          status: "Ended",
        });
        this.send({ type: "TRACK_ENDED", trackId, trackTimeSeconds: position });
      },
      { signal },
    );
    this.media.addEventListener(
      "waiting",
      () => {
        if (this.state.playing) this.setStatus("Buffering...");
      },
      { signal },
    );
    this.media.addEventListener(
      "playing",
      () => {
        let track = this.state.tracks.find(
          (candidate) => candidate.id === this.state.currentTrackId,
        );
        if (track) this.setStatus(`Playing ${track.title}`);
      },
      { signal },
    );
    this.media.addEventListener(
      "progress",
      () => this.updateBufferedSeconds(),
      { signal },
    );
    this.media.addEventListener(
      "durationchange",
      () => {
        if (this.loadedTrackId === this.state.currentTrackId) {
          this.setState({ durationSeconds: this.mediaDuration() });
        }
      },
      { signal },
    );
  }

  private updateBufferedSeconds(): void {
    let bufferedSeconds = 0;
    for (let index = 0; index < this.media.buffered.length; index++) {
      bufferedSeconds = Math.max(
        bufferedSeconds,
        this.media.buffered.end(index),
      );
    }
    this.setState({ bufferedSeconds });
  }

  private startProgressTimer(): void {
    this.stopProgressTimer();
    this.progressTimer = window.setInterval(() => {
      let positionSeconds = this.getCurrentTrackPosition();
      this.currentTime = positionSeconds;
      this.setState({ positionSeconds });
      this.correctPlaybackDrift(positionSeconds);
    }, 250);
  }

  private correctPlaybackDrift(actualPosition: number): void {
    let trackId = this.state.currentTrackId;
    if (!trackId || !this.state.playing) return;
    let correction = this.synchronizer.playbackCorrection(
      trackId,
      actualPosition,
      (position) => this.boundTrackTime(position),
    );
    if (!correction) return;
    if (correction.hardSeekTo !== null)
      this.setMediaTime(correction.hardSeekTo);
    this.media.playbackRate = correction.playbackRate;
    this.setState({
      playbackErrorMs: correction.errorSeconds * 1000,
      playbackRate: correction.playbackRate,
      outputLatencyMs: this.audio.outputLatencyMs?.() ?? 0,
    });
  }

  private stopProgressTimer(): void {
    if (this.progressTimer) window.clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  private clearScheduledAction(): void {
    if (this.scheduledActionTimer)
      window.clearTimeout(this.scheduledActionTimer);
    this.scheduledActionTimer = null;
  }

  private mergeTrack(track: Track): void {
    let exists = this.state.tracks.some(
      (candidate) => candidate.id === track.id,
    );
    let tracks = exists
      ? this.state.tracks.map((candidate) =>
          candidate.id === track.id ? track : candidate,
        )
      : [...this.state.tracks, track];
    this.setState({ tracks });
  }

  private mergeServerTracks(serverTracks: Track[]): Track[] {
    return serverTracks.map((track) => {
      let localTrack = this.state.tracks.find(
        (candidate) => candidate.id === track.id,
      );
      if (!track.upload || !localTrack?.upload) return track;
      return {
        ...track,
        upload: {
          ...track.upload,
          bytesReceived: Math.max(
            track.upload.bytesReceived,
            localTrack.upload.bytesReceived,
          ),
        },
      };
    });
  }

  private updateUploadProgress(trackId: string, bytesSent: number): void {
    this.setState({
      tracks: this.state.tracks.map((track) =>
        track.id === trackId && track.upload
          ? {
              ...track,
              upload: {
                ...track.upload,
                bytesReceived: Math.min(bytesSent, track.upload.sizeBytes),
              },
            }
          : track,
      ),
    });
  }

  private markUploadFailed(trackId: string): void {
    this.setState({
      tracks: this.state.tracks.map((track) =>
        track.id === trackId && track.upload
          ? { ...track, upload: { ...track.upload, status: "failed" as const } }
          : track,
      ),
    });
  }

  private startHeartbeat(): void {
    this.synchronizer.resetClock();
    this.stopHeartbeat();
    let tick = () => {
      this.sendProbePair();
      let interval = !this.synchronizer.synchronized
        ? NTP_CONSTANTS.INITIAL_INTERVAL_MS
        : NTP_CONSTANTS.STEADY_STATE_INTERVAL_MS;
      this.heartbeatTimer = window.setTimeout(tick, interval);
    };
    tick();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) window.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private sendProbePair(): void {
    sendProbePair({
      send: (value) => this.send(value),
      currentRTT: this.state.rttMs || undefined,
      compensationMs: this.synchronizer.deviceCompensationMs,
      nudgeMs: 0,
    });
  }

  private send(value: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(value));
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1000);
  }

  private setStatus(status: string): void {
    this.setState({ status });
  }

  private setState(patch: Partial<RadioClientState>): void {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new CustomEvent("state", { detail: this.state }));
  }
}
