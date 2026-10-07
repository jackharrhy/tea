import { createController } from "remix/router";

import {
  CurrentRoom,
  RadioRuntime,
  requireRegisteredRoom,
} from "../../data/radio-runtime.ts";
import { RadioAccess, requireResourceAccess } from "../../middleware/access.ts";
import { routes } from "../../routes.ts";

export default createController(routes.resources, {
  middleware: [requireResourceAccess(), requireRegisteredRoom()],
  actions: {
    websocket(context) {
      let headers = new Headers(context.request.headers);
      headers.set("x-radio-listener-name", context.get(RadioAccess)!.name);
      return context
        .get(RadioRuntime)!
        .fetchRoom(context.get(CurrentRoom)!.slug, "/websocket", {
          headers,
        });
    },
    createTrack(context) {
      return context
        .get(RadioRuntime)!
        .fetchRoom(context.get(CurrentRoom)!.slug, "/tracks", context.request);
    },
    uploadTrack(context) {
      return context
        .get(RadioRuntime)!
        .uploadTrack(
          context.request,
          context.get(CurrentRoom)!.slug,
          context.params.trackId,
        );
    },
    media(context) {
      if (
        context.request.method !== "GET" &&
        context.request.method !== "HEAD"
      ) {
        return new Response("Method Not Allowed", { status: 405 });
      }
      return context
        .get(RadioRuntime)!
        .serveTrack(
          context.request,
          context.get(CurrentRoom)!.slug,
          context.params.trackId,
        );
    },
  },
});
