import type {
  ClientInfo,
  PlaybackState,
  RoomSnapshot,
  Track,
} from "./protocol.ts";
import type { UploadMetadata } from "./track-metadata.ts";
import { trackTitleFromFilename } from "./track-metadata.ts";

export type PendingPlay = {
  trackId: string;
  trackTimeSeconds: number;
  deadline: number;
};

export type RoomPlayback = PlaybackState & { volume: number };

type TrackRow = {
  id: string;
  title: string;
  media_type: string | null;
  added_at: number;
  position: number;
  upload_status: "uploading" | "failed" | null;
  bytes_received: number;
  size_bytes: number;
};

type PlaybackRow = {
  type: PlaybackState["type"];
  track_id: string | null;
  track_time_seconds: number;
  server_time_to_execute: number;
  volume: number;
};

type PendingPlayRow = {
  track_id: string;
  track_time_seconds: number;
  deadline: number;
};

export class RadioRoomStore {
  private roomSlug: string | null = null;

  constructor(private storage: DurableObjectStorage) {}

  initialize(): void {
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        slug TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        media_type TEXT,
        added_at INTEGER NOT NULL,
        position INTEGER NOT NULL,
        upload_status TEXT,
        bytes_received INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS tracks_position ON tracks(position);
      CREATE TABLE IF NOT EXISTS playback (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        type TEXT NOT NULL,
        track_id TEXT,
        track_time_seconds REAL NOT NULL,
        server_time_to_execute INTEGER NOT NULL,
        volume REAL NOT NULL
      );
      INSERT OR IGNORE INTO playback VALUES (1, 'paused', NULL, 0, 0, 1);
      CREATE TABLE IF NOT EXISTS pending_play (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        track_id TEXT NOT NULL,
        track_time_seconds REAL NOT NULL,
        deadline INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_ready (client_id TEXT PRIMARY KEY);
    `);
    this.roomSlug =
      this.storage.sql
        .exec<{ slug: string }>("SELECT slug FROM room")
        .toArray()[0]?.slug ?? null;
  }

  ensureRoom(roomSlug: string): void {
    if (this.roomSlug === roomSlug) return;
    if (this.roomSlug && this.roomSlug !== roomSlug)
      throw new Error("Room identity mismatch");
    this.storage.sql.exec("INSERT INTO room VALUES (1, ?)", roomSlug);
    this.roomSlug = roomSlug;
  }

  get slug(): string {
    if (!this.roomSlug) throw new Error("Room has not been initialized");
    return this.roomSlug;
  }

  snapshot(clients: ClientInfo[]): RoomSnapshot {
    let playback = this.playback();
    return {
      roomId: this.slug,
      tracks: this.tracks(),
      clients,
      playback: {
        type: playback.type,
        trackId: playback.trackId,
        trackTimeSeconds: playback.trackTimeSeconds,
        serverTimeToExecute: playback.serverTimeToExecute,
      },
      volume: playback.volume,
    };
  }

  tracks(): Track[] {
    return this.storage.sql
      .exec<TrackRow>("SELECT * FROM tracks ORDER BY position")
      .toArray()
      .map((row) => this.toTrack(row));
  }

  track(trackId: string): Track | null {
    let row = this.storage.sql
      .exec<TrackRow>("SELECT * FROM tracks WHERE id = ?", trackId)
      .toArray()[0];
    return row ? this.toTrack(row) : null;
  }

  playback(): RoomPlayback {
    let row = this.playbackRow();
    return { ...toPlaybackState(row), volume: row.volume };
  }

  reserveTrack(input: UploadMetadata): Track {
    let id = crypto.randomUUID();
    let position = this.storage.sql
      .exec<{ position: number }>(
        "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tracks",
      )
      .one().position;
    this.storage.sql.exec(
      `INSERT INTO tracks
        (id, title, media_type, added_at, position, upload_status, bytes_received, size_bytes)
        VALUES (?, ?, ?, ?, ?, 'uploading', 0, ?)`,
      id,
      trackTitleFromFilename(input.name),
      input.mediaType,
      Date.now(),
      position,
      input.sizeBytes,
    );
    return this.track(id)!;
  }

  completeUpload(trackId: string): Track | null {
    this.storage.sql.exec(
      "UPDATE tracks SET upload_status = NULL, bytes_received = size_bytes WHERE id = ? AND upload_status = 'uploading'",
      trackId,
    );
    let track = this.track(trackId);
    return track && !track.upload ? track : null;
  }

  failUpload(trackId: string): void {
    this.storage.sql.exec(
      "UPDATE tracks SET upload_status = 'failed' WHERE id = ? AND upload_status = 'uploading'",
      trackId,
    );
  }

  replacePendingPlay(
    trackId: string,
    trackTimeSeconds: number,
    deadline: number,
  ): void {
    this.clearPendingPlay();
    this.storage.sql.exec(
      "INSERT INTO pending_play VALUES (1, ?, ?, ?)",
      trackId,
      Math.max(0, trackTimeSeconds),
      deadline,
    );
  }

  pendingPlay(): PendingPlay | null {
    let row = this.storage.sql
      .exec<PendingPlayRow>("SELECT * FROM pending_play")
      .toArray()[0];
    return row
      ? {
          trackId: row.track_id,
          trackTimeSeconds: row.track_time_seconds,
          deadline: row.deadline,
        }
      : null;
  }

  markReady(clientId: string): void {
    this.storage.sql.exec(
      "INSERT OR IGNORE INTO pending_ready VALUES (?)",
      clientId,
    );
  }

  readyCount(): number {
    return this.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM pending_ready")
      .one().count;
  }

  clearPendingPlay(): void {
    this.storage.sql.exec(
      "DELETE FROM pending_ready; DELETE FROM pending_play",
    );
  }

  play(
    trackId: string,
    trackTimeSeconds: number,
    serverTimeToExecute: number,
  ): void {
    this.storage.sql.exec(
      "UPDATE playback SET type = 'playing', track_id = ?, track_time_seconds = ?, server_time_to_execute = ? WHERE singleton = 1",
      trackId,
      trackTimeSeconds,
      serverTimeToExecute,
    );
  }

  pause(
    trackId: string,
    trackTimeSeconds: number,
    serverTimeToExecute: number,
  ): void {
    this.storage.sql.exec(
      "UPDATE playback SET type = 'paused', track_id = ?, track_time_seconds = ?, server_time_to_execute = ? WHERE singleton = 1",
      trackId,
      Math.max(0, trackTimeSeconds),
      serverTimeToExecute,
    );
  }

  setVolume(volume: number): number {
    let nextVolume = Math.max(0, Math.min(1, volume));
    this.storage.sql.exec(
      "UPDATE playback SET volume = ? WHERE singleton = 1",
      nextVolume,
    );
    return nextVolume;
  }

  renameTrack(trackId: string, title: string): void {
    this.storage.sql.exec(
      "UPDATE tracks SET title = ? WHERE id = ?",
      title,
      trackId,
    );
  }

  removeTrack(trackId: string): Track | null {
    let track = this.track(trackId);
    if (!track) return null;
    let position = this.storage.sql
      .exec<{ position: number }>(
        "SELECT position FROM tracks WHERE id = ?",
        trackId,
      )
      .one().position;
    this.storage.sql.exec("DELETE FROM tracks WHERE id = ?", trackId);
    this.storage.sql.exec(
      "UPDATE tracks SET position = position - 1 WHERE position > ?",
      position,
    );
    if (this.playback().trackId === trackId) {
      this.storage.sql.exec(
        "UPDATE playback SET type = 'paused', track_id = NULL, track_time_seconds = 0, server_time_to_execute = 0 WHERE singleton = 1",
      );
    }
    if (this.pendingPlay()?.trackId === trackId) this.clearPendingPlay();
    return track;
  }

  reorderTracks(trackIds: string[]): boolean {
    let currentIds = new Set(this.tracks().map((track) => track.id));
    if (
      trackIds.length !== currentIds.size ||
      new Set(trackIds).size !== trackIds.length ||
      trackIds.some((id) => !currentIds.has(id))
    ) {
      return false;
    }
    this.storage.sql.exec("UPDATE tracks SET position = -position - 1");
    trackIds.forEach((id, position) =>
      this.storage.sql.exec(
        "UPDATE tracks SET position = ? WHERE id = ?",
        position,
        id,
      ),
    );
    return true;
  }

  markTrackEnded(trackTimeSeconds: number): void {
    this.storage.sql.exec(
      "UPDATE playback SET type = 'paused', track_time_seconds = ?, server_time_to_execute = ? WHERE singleton = 1",
      Math.max(0, trackTimeSeconds),
      Date.now(),
    );
  }

  objectKey(trackId: string): string {
    return `rooms/${this.slug}/tracks/${trackId}`;
  }

  private toTrack(row: TrackRow): Track {
    return {
      id: row.id,
      title: row.title,
      url: `/media/${encodeURIComponent(this.slug)}/${encodeURIComponent(row.id)}`,
      addedAt: row.added_at,
      mediaType: row.media_type ?? undefined,
      upload: row.upload_status
        ? {
            status: row.upload_status,
            bytesReceived: row.bytes_received,
            sizeBytes: row.size_bytes,
          }
        : undefined,
    };
  }

  private playbackRow(): PlaybackRow {
    return this.storage.sql.exec<PlaybackRow>("SELECT * FROM playback").one();
  }
}

function toPlaybackState(row: PlaybackRow): PlaybackState {
  return {
    type: row.type,
    trackId: row.track_id,
    trackTimeSeconds: row.track_time_seconds,
    serverTimeToExecute: row.server_time_to_execute,
  };
}
