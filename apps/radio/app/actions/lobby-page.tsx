import type { Handle } from "remix/component";
import { css } from "remix/component";

import type { RoomRecord } from "../data/radio-runtime.ts";
import type { RadioIdentity } from "../middleware/access.ts";
import { desktopColor, desktopThemeStyle } from "../ui/desktop/theme.ts";
import { Document } from "../ui/document.tsx";
import { RoomLobby } from "../ui/room-lobby.tsx";

export function LobbyPage(
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
      <Document title="Rooms · tea/radio">
        <main mix={[desktopThemeStyle, lobbyStyle.page]}>
          <RoomLobby
            rooms={rooms}
            identity={identity}
            selectedRoom={selectedRoom}
            message={message}
          />
        </main>
      </Document>
    );
  };
}

const lobbyStyle = {
  page: css({
    minHeight: "100dvh",
    boxSizing: "border-box",
    padding: "clamp(12px, 4vw, 52px)",
    display: "grid",
    placeItems: "center",
    background: `radial-gradient(circle at 50% 12%, ${desktopColor.accentSoft}, transparent 28rem), #d6d6d6`,
  }),
};
