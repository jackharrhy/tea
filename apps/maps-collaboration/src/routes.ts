import { get, post, put, route } from "remix/routes";

export const routes = route({
  health: get("/health"),
  snapshot: get("/sync/maps/:mapId/snapshot"),
  live: get("/sync/maps/:mapId/live"),
  initialize: put("/sync/maps/:mapId/initialize"),
  checkpoints: get("/sync/maps/:mapId/checkpoints"),
  checkpointSource: get("/sync/maps/:mapId/checkpoints/:checkpointId"),
  createCheckpoint: post("/sync/maps/:mapId/checkpoints"),
  source: put("/sync/maps/:mapId/source"),
});
