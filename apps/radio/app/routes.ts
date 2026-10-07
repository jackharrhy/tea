import { get, post, put, route } from "remix/routes";

export const routes = route({
  dev: route("dev", {
    kitchenSink: get("kitchen-sink"),
  }),
  home: get("/"),
  join: post("/join"),
  logout: post("/logout"),
  rooms: {
    create: post("/rooms"),
    show: get("/rooms/:roomSlug"),
  },
  resources: {
    websocket: get("/ws/:roomSlug"),
    createTrack: post("/api/rooms/:roomSlug/tracks"),
    uploadTrack: put("/api/rooms/:roomSlug/tracks/:trackId/content"),
    media: "/media/:roomSlug/:trackId",
  },
});
