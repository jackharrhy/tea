import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { Session } from "remix/session";

import {
  DEFAULT_ROOM_SLUG,
  normalizeRoomSlug,
  roomPath,
} from "../data/room-id.ts";
import { RadioRuntime } from "../data/radio-runtime.ts";
import { RadioAccess } from "../middleware/access.ts";
import { routes } from "../routes.ts";
import { LobbyPage } from "./lobby-page.tsx";

export default createController(routes, {
  actions: {
    async home(context) {
      let rooms = await context.get(RadioRuntime)!.listRooms();
      let requested = normalizeRoomSlug(
        new URL(context.request.url).searchParams.get("room") ?? "",
      );
      let selectedRoom = rooms.some((room) => room.slug === requested)
        ? requested!
        : (rooms[0]?.slug ?? DEFAULT_ROOM_SLUG);
      return context.render(
        <LobbyPage
          rooms={rooms}
          identity={context.get(RadioAccess) ?? null}
          selectedRoom={selectedRoom}
          message={context.get(Session)!.get("message") as string | undefined}
        />,
      );
    },
    async join(context) {
      let form = context.get(FormData);
      let name = String(form.get("name") ?? "").trim();
      let roomSlug = normalizeRoomSlug(String(form.get("roomSlug") ?? ""));
      let runtime = context.get(RadioRuntime)!;
      let currentIdentity = context.get(RadioAccess) ?? null;
      if (
        !name ||
        name.length > 40 ||
        !roomSlug ||
        !(await runtime.getRoom(roomSlug))
      ) {
        return lobbyError(
          context.get(Session)!,
          "Choose a room and enter a name.",
          roomSlug,
        );
      }
      if (!currentIdentity) return redirect(routes.auth.login.href(), 303);
      let session = context.get(Session)!;
      session.set("name", name);
      return redirect(roomPath(roomSlug), 303);
    },
    logout(context) {
      context.get(Session)!.destroy();
      return redirect(routes.home.href(), 303);
    },
  },
});

function lobbyError(
  session: Session,
  message: string,
  roomSlug: string | null,
) {
  session.flash("message", message);
  let href = routes.home.href();
  if (roomSlug) href += `?room=${encodeURIComponent(roomSlug)}`;
  return redirect(href, 303);
}
