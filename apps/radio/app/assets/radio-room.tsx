import {
  clientEntry,
  type Handle,
  type SerializableProps,
} from "remix/component";

import type { RoomSnapshot } from "../data/protocol.ts";
import {
  DEFAULT_SYNC_DIAGNOSTICS,
  RadioClient,
  type RadioClientState,
} from "./radio-client.ts";
import { RadioPlayerView, TrackList } from "./radio-room-components.tsx";

interface RadioRoomProps extends SerializableProps {
  initialSnapshot: RoomSnapshot;
  roomName: string;
}

export const RadioRoom = clientEntry(
  "radio-room#RadioRoom",
  function RadioRoomComponent(handle: Handle<RadioRoomProps>) {
    let initialSnapshot = handle.props.initialSnapshot;
    let client: RadioClient | null = null;
    let trackInput: HTMLInputElement | null = null;
    let viewportWidth = 960;
    let state: RadioClientState = {
      connected: false,
      synced: false,
      offsetMs: 0,
      rttMs: 0,
      ...DEFAULT_SYNC_DIAGNOSTICS,
      tracks: initialSnapshot.tracks,
      clients: initialSnapshot.clients,
      currentTrackId: initialSnapshot.playback.trackId,
      bufferingTrackId: null,
      readyClientCount: 0,
      totalClientCount: 0,
      bufferedSeconds: 0,
      playing: initialSnapshot.playback.type === "playing",
      positionSeconds: initialSnapshot.playback.trackTimeSeconds,
      durationSeconds: 0,
      volume: initialSnapshot.volume,
      status: "Ready",
    };

    function start() {
      if (client) return;
      let clientId = getOrCreateClientId();
      let deviceCompensationMs = readDeviceCompensation();
      client = new RadioClient({
        initialSnapshot,
        clientId,
        deviceCompensationMs,
      });
      client.onState((nextState) => {
        state = nextState;
        handle.update();
      });
      client.connect();
      handle.update();
    }

    async function uploadSelectedTrack(input: HTMLInputElement) {
      if (!input.files?.[0]) return;
      await client?.upload(input.files[0]);
      input.value = "";
    }

    handle.signal.addEventListener("abort", () => {
      client?.dispose();
    });

    handle.queueTask(() => {
      let updateViewportWidth = () => {
        viewportWidth =
          document.documentElement.clientWidth || window.innerWidth;
        handle.update();
      };
      updateViewportWidth();
      window.addEventListener("resize", updateViewportWidth, {
        signal: handle.signal,
      });
      start();
    });

    return () => {
      return (
        <RadioPlayerView
          state={state}
          client={client}
          roomName={handle.props.roomName}
          viewportWidth={viewportWidth}
          onTrackInput={(node, signal) => {
            trackInput = node;
            signal.addEventListener("abort", () => {
              if (trackInput === node) trackInput = null;
            });
          }}
          onUploadSelected={(input) => void uploadSelectedTrack(input)}
          onAddTrack={() => trackInput?.click()}
        />
      );
    };
  },
);

interface TrackListPreviewProps extends SerializableProps {
  stateJson: string;
  surface: number;
}

export const TrackListPreview = clientEntry(
  "radio-room#TrackListPreview",
  function TrackListPreviewComponent(handle: Handle<TrackListPreviewProps>) {
    let state = JSON.parse(handle.props.stateJson) as RadioClientState;
    let client = {
      play(trackId: string) {
        state = { ...state, currentTrackId: trackId, playing: true };
        handle.update();
      },
      removeTrack(trackId: string) {
        state = {
          ...state,
          tracks: state.tracks.filter((track) => track.id !== trackId),
          currentTrackId:
            state.currentTrackId === trackId ? null : state.currentTrackId,
        };
        handle.update();
      },
      renameTrack(trackId: string, title: string) {
        state = {
          ...state,
          tracks: state.tracks.map((track) =>
            track.id === trackId ? { ...track, title } : track,
          ),
        };
        handle.update();
      },
      reorderTracks(trackIds: string[]) {
        let tracksById = new Map(
          state.tracks.map((track) => [track.id, track]),
        );
        let tracks = trackIds.flatMap((trackId) => {
          let track = tracksById.get(trackId);
          return track ? [track] : [];
        });
        if (tracks.length !== state.tracks.length) return;
        state = { ...state, tracks };
        handle.update();
      },
    } as RadioClient;

    return () => (
      <TrackList state={state} client={client} surface={handle.props.surface} />
    );
  },
);

function getOrCreateClientId(): string {
  let existing = localStorage.getItem("radio.clientId");
  if (existing) return existing;
  let next = createClientId();
  localStorage.setItem("radio.clientId", next);
  return next;
}

function readDeviceCompensation(): number {
  let value = Number(localStorage.getItem("radio.deviceCompensationMs"));
  return Number.isFinite(value) ? value : 0;
}

type ClientCrypto = {
  getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
  randomUUID?: () => string;
};

export function createClientId(source: ClientCrypto = crypto): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  let bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  let hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
