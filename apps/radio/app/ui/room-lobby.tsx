import type { Handle } from "remix/component";
import { css } from "remix/component";

import type { RoomRecord } from "../data/radio-runtime.ts";
import type { RadioIdentity } from "../middleware/access.ts";
import { routes } from "../routes.ts";
import { desktopColor } from "./desktop/theme.ts";
import { desktopControlStyle, desktopStyle } from "./desktop/styles.ts";
import { RadioHeader } from "./radio-header.tsx";

export function RoomLobby(
  handle: Handle<{
    rooms: RoomRecord[];
    identity: RadioIdentity | null;
    selectedRoom: string;
    message?: string;
  }>,
) {
  return () => {
    let { rooms, identity, selectedRoom, message } = handle.props;
    return (
      <section mix={[desktopStyle.window, roomLobbyStyle.window]}>
        <RadioHeader />

        <div mix={roomLobbyStyle.body}>
          {message ? (
            <p role="alert" mix={roomLobbyStyle.message}>
              {message}
            </p>
          ) : null}

          <div mix={roomLobbyStyle.joinPanel}>
            <form
              method="get"
              action={routes.home.href()}
              aria-label="Rooms"
              mix={roomLobbyStyle.rooms}
            >
              {rooms.map((room) => (
                <button
                  key={room.slug}
                  type="submit"
                  name="room"
                  value={room.slug}
                  aria-label={
                    room.slug === selectedRoom
                      ? `${room.name}, selected`
                      : room.name
                  }
                  data-selected={
                    room.slug === selectedRoom ? "true" : undefined
                  }
                  mix={roomLobbyStyle.room}
                >
                  {room.name}
                </button>
              ))}
            </form>

            <form
              method="post"
              action={routes.join.href()}
              data-authenticated={identity ? "true" : "false"}
              mix={roomLobbyStyle.joinForm}
            >
              <input name="roomSlug" type="hidden" value={selectedRoom} />
              <input
                mix={desktopStyle.input}
                name="name"
                type="text"
                autocomplete="name"
                aria-label="Username"
                placeholder="username"
                value={identity?.name ?? ""}
                maxlength={40}
                required={true}
              />
              {!identity ? (
                <input
                  mix={desktopStyle.input}
                  name="password"
                  type="password"
                  autocomplete="current-password"
                  aria-label="Password"
                  placeholder="password"
                  maxlength={256}
                  required={true}
                />
              ) : null}
              <button
                mix={[desktopStyle.primaryButton, roomLobbyStyle.joinButton]}
                type="submit"
              >
                join
              </button>
            </form>
          </div>

          {identity ? (
            <section mix={[desktopStyle.panel, roomLobbyStyle.createPanel]}>
              <h2>start a room</h2>
              <p>A new room starts with its own empty queue.</p>
              <form
                method="post"
                action={routes.rooms.create.href()}
                mix={roomLobbyStyle.createForm}
              >
                <label mix={roomLobbyStyle.field}>
                  <span>room name</span>
                  <input
                    mix={[desktopStyle.input, roomLobbyStyle.lowercaseInput]}
                    name="name"
                    autocapitalize="none"
                    maxlength={48}
                    required={true}
                  />
                </label>
                <label mix={roomLobbyStyle.field}>
                  <span>address</span>
                  <input
                    mix={[desktopStyle.input, roomLobbyStyle.lowercaseInput]}
                    name="slug"
                    placeholder="late-night"
                    autocapitalize="none"
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    maxlength={40}
                    required={true}
                  />
                </label>
                <button mix={desktopStyle.primaryButton} type="submit">
                  create room
                </button>
              </form>
            </section>
          ) : null}

          {identity ? (
            <form
              method="post"
              action={routes.logout.href()}
              mix={roomLobbyStyle.signOutForm}
            >
              <button mix={desktopStyle.smallButton} type="submit">
                sign out
              </button>
            </form>
          ) : null}
        </div>
      </section>
    );
  };
}

const roomLobbyStyle = {
  window: css({ width: "min(760px, 100%)" }),
  body: css({
    display: "grid",
    gap: "14px",
    padding: "clamp(20px, 4vw, 32px)",
  }),
  message: css({
    margin: 0,
    padding: "10px",
    background: "#fff3cd",
    border: `1px solid ${desktopColor.line}`,
  }),
  joinPanel: css({
    display: "grid",
    gap: "12px",
    padding: "14px",
    background: desktopColor.paper,
    border: `1px solid ${desktopColor.line}`,
    boxShadow: "0 0 0 1px #fff inset",
  }),
  joinForm: css({
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
    alignItems: "end",
    gap: "12px",
    '&[data-authenticated="true"]': {
      gridTemplateColumns: "minmax(0, 1fr) auto",
    },
    "@media (max-width: 620px)": {
      gridTemplateColumns: "1fr",
      '&[data-authenticated="true"]': { gridTemplateColumns: "1fr" },
      "& > button": { width: "100%" },
    },
  }),
  rooms: css({
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "8px",
  }),
  room: css({
    ...desktopControlStyle.button,
    width: "100%",
    height: "auto",
    minHeight: "42px",
    padding: "7px 11px",
    textAlign: "center",
    transition:
      "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
    "&:hover": {
      background: desktopColor.wash,
      borderColor: desktopColor.accent,
    },
    '&[data-selected="true"]': {
      background: desktopColor.accentSoft,
      borderColor: desktopColor.ink,
      boxShadow: `0 1px #fff inset, 0 0 0 1px ${desktopColor.paper} inset`,
    },
    "&:active": {
      background: desktopColor.accentSoft,
      transform: "translateY(1px)",
    },
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  }),
  field: css({
    minWidth: 0,
    display: "grid",
    gap: "4px",
    "& > span": {
      fontSize: "12px",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
    },
  }),
  joinButton: css({
    minWidth: "112px",
    alignSelf: "end",
    "&:active": { transform: "translateY(1px)" },
  }),
  createPanel: css({
    padding: "16px",
    "& h2": { margin: 0, fontSize: "18px", lineHeight: 1.1 },
    "& p": { margin: "5px 0 14px", color: "#445159" },
  }),
  createForm: css({
    display: "grid",
    gridTemplateColumns: "1fr 1fr auto",
    alignItems: "end",
    gap: "10px",
    "@media (max-width: 620px)": { gridTemplateColumns: "1fr" },
  }),
  lowercaseInput: css({ textTransform: "lowercase" }),
  signOutForm: css({ justifySelf: "end" }),
};
