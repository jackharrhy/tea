import type { ServiceRoute } from "../service-routing.js";
import type { WorldviewServiceOptions } from "../service-options.js";
import { createAuthRoutes } from "./auth-routes.js";
import { createBuildRoutes } from "./build-routes.js";
import { createMapRoutes } from "./map-routes.js";
import { createMcpRoutes } from "./mcp-routes.js";
import { createProjectRoutes } from "./project-routes.js";
import { createResourceRoutes } from "./resource-routes.js";

export function createServiceRoutes(
  options: WorldviewServiceOptions,
): readonly ServiceRoute[] {
  return [
    ...createAuthRoutes(options),
    ...createMcpRoutes(options),
    ...createProjectRoutes(options),
    ...createResourceRoutes(options),
    ...createMapRoutes(options),
    ...createBuildRoutes(options),
  ];
}
