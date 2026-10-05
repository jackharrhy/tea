import { get, post, route } from "remix/routes";
export const routes = route({
  health: get("/healthz"),
  protectedResource: get("/.well-known/oauth-protected-resource/mcp"),
  mcp: post("/mcp"),
});
