import { css, type Handle, type RemixNode } from "remix/component";

import {
  RadioPlayerView,
  StatusPill,
} from "../../assets/radio-room-components.tsx";
import { radioStyle } from "../../assets/radio-room-styles.ts";
import {
  DEFAULT_SYNC_DIAGNOSTICS,
  type RadioClientState,
} from "../../assets/radio-client.ts";
import { TrackListPreview } from "../../assets/radio-room.tsx";
import type { ClientInfo, Track } from "../../data/protocol.ts";
import type { RoomRecord } from "../../data/radio-runtime.ts";
import {
  desktopControlStyle,
  desktopIconStyle,
  desktopStyle,
} from "../../ui/desktop/styles.ts";
import { desktopColor, desktopThemeStyle } from "../../ui/desktop/theme.ts";
import { Document } from "../../ui/document.tsx";
import { RoomLobby } from "../../ui/room-lobby.tsx";

const tracks: Track[] = [
  {
    id: "track-1",
    title: "Bickle - Naked",
    url: "/dev/track-1.mp3",
    addedAt: 1,
  },
  {
    id: "track-2",
    title: "Coco & Clair Clair, Paul Maxwell - Crushcrushcrush",
    url: "/dev/track-2.mp3",
    addedAt: 2,
  },
  {
    id: "track-3",
    title: "Colin Stetson - The Righteous Wrath of an Honorable Man",
    url: "/dev/track-3.mp3",
    addedAt: 3,
  },
  {
    id: "track-4",
    title: "Lionmilk, Mndsgn - Forever",
    url: "/dev/track-4.mp3",
    addedAt: 4,
  },
];

const uploadingTrack: Track = {
  id: "track-upload",
  title: "Two hour mix",
  url: "/dev/track-upload.mp3",
  addedAt: 5,
  upload: {
    status: "uploading",
    bytesReceived: 65_011_712,
    sizeBytes: 209_715_200,
  },
};

const clients: ClientInfo[] = [
  client("client-1", "Jack", 1),
  client("client-2", "Ada", 18),
  client("client-3", "Lin", 42),
  client("client-4", "Sam with a long name", 127),
];

const denseTrackTitles = [
  "Boards of Canada - Roygbiv",
  "Daft Punk - Voyager",
  "Naked Flames - Pan Matsuri",
  "Boards of Canada - Dayvan Cowboy",
  "Naked Flames - Carrot Car",
  "Daft Punk - Veridis Quo",
  "Boards of Canada - Music Is Math",
  "Naked Flames - Tennessee Transit",
  "Daft Punk - Something About Us",
  "Boards of Canada - Telephasic Workshop",
  "Naked Flames - Visiting Corners",
  "Daft Punk - Revolution 909",
  "Boards of Canada - Sunshine Recorder",
  "Naked Flames - Under Every Tree in England",
  "Daft Punk - Fresh",
  "Boards of Canada - Turquoise Hexagon Sun",
  "Naked Flames - 247 365",
  "Daft Punk - Motherboard",
  "Boards of Canada - Peacock Tail",
  "Naked Flames - Waterslug2",
  "Daft Punk - Contact",
  "Boards of Canada - Chromakey Dreamcoat",
  "Naked Flames - Undisputed Altitude",
  "Daft Punk - Face to Face",
] as const;

const denseTracks: Track[] = denseTrackTitles.map((title, index) => ({
  id: `dense-track-${index + 1}`,
  title,
  url: `/dev/dense-track-${index + 1}.mp3`,
  addedAt: index + 1,
}));

const denseClientSeeds = [
  ["Jack", 1],
  ["Mira", 8],
  ["Seok", 12],
  ["Paloma", 18],
  ["Imani", 23],
  ["Theo", 31],
  ["Noemi", 42],
  ["Basil", 55],
  ["Nia", 67],
  ["Otis", 74],
  ["Cy", 89],
  ["Priya", 104],
  ["Kenji", 127],
  ["Esme", 145],
  ["Sora", 163],
  ["Jules", 186],
  ["Safiya", 0],
  ["Nico", 11],
  ["Min", 29],
  ["Rowan", 48],
  ["Farah", 77],
  ["Dario", 96],
  ["Leila", 132],
  ["Yves", 211],
] as const;

const denseClients: ClientInfo[] = denseClientSeeds.map(([name, rtt], index) =>
  client(`dense-client-${index + 1}`, name, rtt),
);

const rooms: RoomRecord[] = [
  { slug: "cozy", name: "cozy", createdAt: 1 },
  { slug: "kitchen", name: "kitchen", createdAt: 2 },
  { slug: "late-night", name: "late night", createdAt: 3 },
];

const colorTokens = [
  ["ink", desktopColor.ink],
  ["line", desktopColor.line],
  ["paper", desktopColor.paper],
  ["wash", desktopColor.wash],
  ["stripe", desktopColor.stripe],
  ["accent", desktopColor.accent],
  ["accent-soft", desktopColor.accentSoft],
] as const;

const glyphCandidates = [
  ["play", "play_arrow"],
  ["pause", "pause"],
  ["sync", "sync"],
  ["power", "power_settings_new"],
  ["remove", "close"],
] as const;

export function KitchenSinkPage() {
  return () => (
    <Document title="Radio / UI" head={<KitchenSinkHead />}>
      <main mix={[desktopThemeStyle, sinkStyle.page]}>
        <header mix={sinkStyle.toolbar}>
          <strong>radio/ui</strong>
          <nav aria-label="Kitchen sink sections" mix={sinkStyle.nav}>
            <a href="#home">home</a>
            <a href="#tokens">tokens</a>
            <a href="#controls">controls</a>
            <a href="#status">status</a>
            <a href="#buffering">buffering</a>
            <a href="#player">player</a>
            <a href="/" aria-label="Open radio">
              ↗
            </a>
          </nav>
        </header>

        <div mix={sinkStyle.stack}>
          <SinkSection id="home" title="home">
            <div mix={sinkStyle.homeStack}>
              <Specimen label="signed out">
                <RoomLobby rooms={rooms} identity={null} selectedRoom="cozy" />
              </Specimen>
              <Specimen label="signed in">
                <RoomLobby
                  rooms={rooms}
                  identity={{ name: "Jack", authenticatedAt: 1 }}
                  selectedRoom="kitchen"
                />
              </Specimen>
            </div>
          </SinkSection>

          <SinkSection id="tokens" title="tokens">
            <div mix={sinkStyle.tokenGrid}>
              {colorTokens.map(([name, color]) => (
                <div key={name} mix={sinkStyle.token}>
                  <span style={{ background: color }} />
                  <code>{name}</code>
                </div>
              ))}
            </div>
          </SinkSection>

          <SinkSection id="controls" title="controls">
            <div mix={sinkStyle.controlGrid}>
              <Specimen label="buttons">
                <div mix={sinkStyle.controlRow}>
                  <button type="button" mix={controlButtonStyle}>
                    default
                  </button>
                  <button type="button" mix={desktopStyle.smallButton}>
                    small
                  </button>
                  <button type="button" mix={radioStyle.primaryButton}>
                    primary
                  </button>
                  <button type="button" mix={radioStyle.smallPrimaryButton}>
                    small primary
                  </button>
                  <button
                    type="button"
                    mix={radioStyle.smallDangerButton}
                    aria-label="Remove"
                    title="Remove"
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    mix={radioStyle.playToggle}
                    aria-label="Play"
                    title="Play"
                  >
                    Play
                  </button>
                  <button
                    type="button"
                    mix={radioStyle.iconButton}
                    aria-label="Sync playback"
                    title="Sync playback"
                  >
                    Sync
                  </button>
                  <button
                    type="button"
                    mix={controlButtonStyle}
                    disabled={true}
                  >
                    disabled
                  </button>
                </div>
              </Specimen>
              <Specimen label="glyphs">
                <div mix={sinkStyle.controlRow}>
                  {glyphCandidates.map(([label, glyph]) => (
                    <button
                      key={label}
                      aria-label={label}
                      title={label}
                      type="button"
                      mix={glyphButtonStyle}
                    >
                      {glyph}
                    </button>
                  ))}
                </div>
              </Specimen>
              <Specimen label="inputs">
                <div mix={sinkStyle.inputStack}>
                  <input
                    aria-label="Empty input"
                    mix={radioStyle.input}
                    placeholder="name"
                  />
                  <input
                    aria-label="Filled input"
                    mix={radioStyle.input}
                    value="Jack"
                    readOnly={true}
                  />
                  <label mix={sinkStyle.range}>
                    <span>31</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value="31"
                      readOnly={true}
                    />
                  </label>
                  <label mix={sinkStyle.range}>
                    <span>∅</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value="0"
                      disabled={true}
                    />
                  </label>
                </div>
              </Specimen>
              <Specimen label="surfaces">
                <div mix={sinkStyle.surfaceStack}>
                  <div mix={desktopStyle.titleBar}>title</div>
                  <div mix={desktopStyle.messageLabel}>label</div>
                  <div mix={desktopStyle.panel}>panel</div>
                  <div mix={desktopStyle.messageCard}>card</div>
                </div>
              </Specimen>
            </div>
          </SinkSection>

          <SinkSection id="status" title="status">
            <div mix={sinkStyle.statusGrid}>
              <StatusSpecimen
                label="offline"
                state={state({ connected: false, synced: false })}
              />
              <StatusSpecimen
                label="syncing"
                state={state({ connected: true, synced: false })}
              />
              <StatusSpecimen
                label="synced"
                state={state({ connected: true, synced: true, rttMs: 1 })}
              />
              <StatusSpecimen
                label="latency"
                state={state({ connected: true, synced: true, rttMs: 127 })}
              />
            </div>
          </SinkSection>

          <SinkSection id="buffering" title="buffering">
            <div mix={sinkStyle.bufferingGrid}>
              <QueueSpecimen
                label="upload / 31%"
                state={state({
                  tracks: [...tracks, uploadingTrack],
                  connected: true,
                  synced: true,
                })}
              />
              <QueueSpecimen
                label="client readiness / 1 of 4"
                state={state({
                  tracks,
                  clients,
                  currentTrackId: "track-2",
                  bufferingTrackId: "track-2",
                  readyClientCount: 1,
                  totalClientCount: 4,
                  connected: true,
                  synced: true,
                  durationSeconds: 242,
                  status: "Buffering clients",
                })}
              />
            </div>
          </SinkSection>

          <SinkSection id="player" title="player">
            <div mix={sinkStyle.playerStack}>
              <PlayerSpecimen
                label="empty"
                state={state({
                  connected: true,
                  synced: true,
                  status: "Ready",
                })}
              />
              <PlayerSpecimen
                label="offline"
                state={state({
                  tracks,
                  currentTrackId: "track-1",
                  connected: false,
                  synced: false,
                  durationSeconds: 242,
                  positionSeconds: 64,
                  status: "Disconnected. Reconnecting...",
                })}
              />
              <PlayerSpecimen
                label="loading / syncing"
                state={state({
                  tracks,
                  clients: clients.slice(0, 1),
                  currentTrackId: "track-2",
                  connected: true,
                  synced: false,
                  status: "Loading Coco & Clair Clair...",
                })}
              />
              <PlayerSpecimen
                label="paused"
                state={state({
                  tracks,
                  clients: clients.slice(0, 2),
                  currentTrackId: "track-3",
                  connected: true,
                  synced: true,
                  rttMs: 18,
                  durationSeconds: 368,
                  positionSeconds: 143,
                  volume: 0.54,
                  status: "Paused",
                })}
              />
              <PlayerSpecimen
                label="paused / 20ms earlier"
                state={state({
                  tracks,
                  clients: clients.slice(0, 2),
                  currentTrackId: "track-3",
                  connected: true,
                  synced: true,
                  rttMs: 18,
                  deviceCompensationMs: 20,
                  durationSeconds: 368,
                  positionSeconds: 143,
                  volume: 0.54,
                  status: "Paused",
                })}
              />
              <PlayerSpecimen
                label="playing / dense"
                state={state({
                  tracks: denseTracks,
                  clients: denseClients,
                  currentTrackId: "dense-track-17",
                  connected: true,
                  synced: true,
                  rttMs: 127,
                  playing: true,
                  durationSeconds: 219,
                  positionSeconds: 187,
                  volume: 0.31,
                  status: "Playing",
                })}
              />
            </div>
          </SinkSection>
        </div>
      </main>
    </Document>
  );
}

function KitchenSinkHead() {
  return () => (
    <>
      <meta name="color-scheme" content="light" />
      <meta name="robots" content="noindex, nofollow" />
    </>
  );
}

function SinkSection(
  handle: Handle<{ id: string; title: string; children?: RemixNode }>,
) {
  return () => (
    <section id={handle.props.id} mix={sinkStyle.section}>
      <h1>{handle.props.title}</h1>
      {handle.props.children}
    </section>
  );
}

function Specimen(handle: Handle<{ label: string; children?: RemixNode }>) {
  return () => (
    <article mix={sinkStyle.specimen}>
      <header>{handle.props.label}</header>
      <div>{handle.props.children}</div>
    </article>
  );
}

function StatusSpecimen(
  handle: Handle<{ label: string; state: RadioClientState }>,
) {
  return () => (
    <Specimen label={handle.props.label}>
      <div mix={desktopStyle.titleBar}>
        <StatusPill state={handle.props.state} />
      </div>
    </Specimen>
  );
}

function PlayerSpecimen(
  handle: Handle<{ label: string; state: RadioClientState }>,
) {
  return () => (
    <Specimen label={handle.props.label}>
      <RadioPlayerView
        state={handle.props.state}
        client={null}
        preview={true}
        roomName="cozy"
        viewportWidth={960}
      />
    </Specimen>
  );
}

function QueueSpecimen(
  handle: Handle<{ label: string; state: RadioClientState }>,
) {
  return () => {
    let previewState = {
      ...handle.props.state,
      syncUncertaintyMs: Number.isFinite(handle.props.state.syncUncertaintyMs)
        ? handle.props.state.syncUncertaintyMs
        : 0,
    };
    return (
      <Specimen label={handle.props.label}>
        <section
          mix={[
            radioStyle.panel,
            radioStyle.queuePanel,
            sinkStyle.queuePreview,
          ]}
        >
          <div mix={radioStyle.sectionHeader}>
            <h2>playlist</h2>
          </div>
          <div mix={radioStyle.queueScroll}>
            <TrackListPreview
              stateJson={JSON.stringify(previewState)}
              surface={780}
            />
          </div>
        </section>
      </Specimen>
    );
  };
}

function state(overrides: Partial<RadioClientState> = {}): RadioClientState {
  return {
    connected: false,
    synced: false,
    offsetMs: 0,
    rttMs: 0,
    ...DEFAULT_SYNC_DIAGNOSTICS,
    tracks: [],
    clients: [],
    currentTrackId: null,
    bufferingTrackId: null,
    readyClientCount: 0,
    totalClientCount: 0,
    bufferedSeconds: 0,
    playing: false,
    positionSeconds: 0,
    durationSeconds: 0,
    volume: 1,
    status: "Ready",
    ...overrides,
  };
}

function client(clientId: string, name: string, rtt: number): ClientInfo {
  return {
    clientId,
    name,
    rtt,
    compensationMs: 0,
    nudgeMs: 0,
    joinedAt: 1,
    lastSeenAt: 1,
  };
}

const controlButtonStyle = css(desktopControlStyle.button);
const glyphButtonStyle = css({
  ...desktopControlStyle.button,
  ...desktopIconStyle,
  width: "36px",
  padding: 0,
  fontSize: "16px",
});

const sinkStyle = {
  page: css({
    minHeight: "100vh",
    background: "#d6d6d6",
    color: desktopColor.ink,
    paddingBottom: "96px",
    "& *, & *::before, & *::after": { boxSizing: "border-box" },
  }),
  toolbar: css({
    position: "sticky",
    zIndex: 10,
    top: 0,
    minHeight: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "6px 12px",
    color: "#fff",
    background: "linear-gradient(#6d777c, #4d575d)",
    borderBottom: `1px solid ${desktopColor.ink}`,
    textShadow: "0 1px #000",
  }),
  nav: css({
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: "4px",
    "& a": {
      minHeight: "26px",
      display: "grid",
      placeItems: "center",
      padding: "0 8px",
      color: "#fff",
      border: "1px solid rgba(255,255,255,0.4)",
      textDecoration: "none",
      textShadow: "0 1px #000",
    },
    "& a:hover, & a:focus-visible": {
      color: desktopColor.ink,
      background: desktopColor.accentSoft,
      textShadow: "none",
      outline: "none",
    },
    "@media (max-width: 640px)": {
      "& a:not(:last-child)": { display: "none" },
    },
  }),
  stack: css({
    width: "min(1080px, calc(100% - 24px))",
    margin: "0 auto",
    display: "grid",
    gap: "48px",
    paddingTop: "32px",
  }),
  section: css({
    scrollMarginTop: "56px",
    display: "grid",
    gap: "12px",
    "& > h1": {
      margin: 0,
      fontSize: "12px",
      lineHeight: "16px",
      fontWeight: 400,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
    },
  }),
  specimen: css({
    minWidth: 0,
    display: "grid",
    gridTemplateRows: "24px minmax(0, auto)",
    border: `1px solid ${desktopColor.line}`,
    background: "rgba(248, 251, 251, 0.55)",
    "& > header": {
      display: "flex",
      alignItems: "center",
      padding: "0 7px",
      borderBottom: `1px solid ${desktopColor.line}`,
      background: desktopColor.wash,
      fontSize: "11px",
      lineHeight: "16px",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    },
    "& > div": { minWidth: 0, padding: "12px" },
  }),
  tokenGrid: css({
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: "6px",
  }),
  token: css({
    display: "grid",
    gridTemplateColumns: "40px minmax(0, 1fr)",
    minHeight: "40px",
    alignItems: "center",
    background: desktopColor.paper,
    border: `1px solid ${desktopColor.line}`,
    "& > span": {
      alignSelf: "stretch",
      borderRight: `1px solid ${desktopColor.line}`,
    },
    "& code": { padding: "0 8px", fontFamily: "inherit", fontSize: "12px" },
  }),
  controlGrid: css({
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "8px",
    "@media (max-width: 900px)": { gridTemplateColumns: "1fr" },
  }),
  controlRow: css({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
  }),
  inputStack: css({ display: "grid", gap: "8px" }),
  range: css({
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr)",
    alignItems: "center",
    gap: "8px",
    "& input": { ...desktopControlStyle.range, width: "100%", minWidth: 0 },
  }),
  surfaceStack: css({
    display: "grid",
    gap: "8px",
    "& > div": { minHeight: "36px" },
  }),
  statusGrid: css({
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "8px",
    "& article > div": { padding: 0 },
    "@media (max-width: 900px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    },
    "@media (max-width: 520px)": { gridTemplateColumns: "1fr" },
  }),
  bufferingGrid: css({ display: "grid", gap: "12px" }),
  homeStack: css({
    display: "grid",
    gap: "18px",
    "& article > div": { display: "grid", justifyItems: "center" },
  }),
  queuePreview: css({ minHeight: 0 }),
  playerStack: css({ display: "grid", gap: "18px" }),
} as const;
