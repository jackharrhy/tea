import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { Session } from "remix/session";

import { normalizeRoomName, normalizeRoomSlug } from "../../data/room-id.ts";
import {
  CurrentRoom,
  RadioRuntime,
  readSnapshot,
  requireRegisteredRoom,
} from "../../data/radio-runtime.ts";
import { requirePageAccess } from "../../middleware/access.ts";
import { routes } from "../../routes.ts";
import { RadioPage } from "../../ui/radio-page.tsx";

export default createController(routes.rooms, {
  actions: {
    create: {
      middleware: [requirePageAccess()],
      async handler(context) {
        let form = context.get(FormData);
        let name = normalizeRoomName(String(form.get("name") ?? ""));
        let slug = normalizeRoomSlug(String(form.get("slug") ?? ""));
        if (!slug || !name || name.length > 48) {
          context
            .get(Session)!
            .flash("message", "Use a room name and a lowercase address.");
          return redirect(routes.home.href(), 303);
        }
        let result = await context
          .get(RadioRuntime)!
          .createRoom({ slug, name });
        if (result === "exists") {
          context
            .get(Session)!
            .flash("message", "That room address is already taken.");
          return redirect(routes.home.href(), 303);
        }
        return redirect(routes.rooms.show.href({ roomSlug: slug }), 303);
      },
    },
    show: {
      middleware: [requirePageAccess(), requireRegisteredRoom()],
      async handler(context) {
        let room = context.get(CurrentRoom)!;
        let snapshot = await readSnapshot(
          await context.get(RadioRuntime)!.fetchRoom(room.slug, "/snapshot"),
        );
        if (!snapshot) return new Response("Room unavailable", { status: 503 });
        return context.render(
          <RadioPage snapshot={snapshot} roomName={room.name} />,
        );
      },
    },
  },
});
