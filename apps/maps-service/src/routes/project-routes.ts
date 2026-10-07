import {
  CreateHostedMapRequestSchema,
  CreateHostedProjectRequestSchema,
  HostedMapCreatedResponseSchema,
  HostedProjectCreatedResponseSchema,
  HostedProjectMembersResponseSchema,
  HostedProjectResponseSchema,
  HostedProjectsResponseSchema,
  SetProjectMemberRoleRequestSchema,
} from "@tea/maps-protocol";

import { canEditProject } from "../access-policy.js";
import { MAX_HOSTED_MAP_BYTES } from "../service-http.js";
import { defineWebRoute, pathParameter } from "../service-routing.js";
import {
  rejectCrossOriginMutation,
  requireWebUser,
  webError,
  webJson,
  webOk,
  webRequestBody,
} from "../service-web-http.js";
import type { WorldviewServiceOptions } from "../service-options.js";

const EMPTY_MAP = '{\n"classname" "worldspawn"\n}\n';

export function createProjectRoutes(
  options: Pick<WorldviewServiceOptions, "database" | "maps">,
) {
  return [
    defineWebRoute("list-projects", "GET", "/api/projects", (context) => {
      const user = requireWebUser(context, options.database);
      return webJson(200, HostedProjectsResponseSchema, {
        projects: [...options.database.listProjects(user.id)],
      });
    }),
    defineWebRoute(
      "create-project",
      "POST",
      "/api/projects",
      async (context) => {
        const denied = rejectCrossOriginMutation(context);
        if (denied) return denied;
        const user = requireWebUser(context, options.database);
        const input = await webRequestBody(
          context.request,
          CreateHostedProjectRequestSchema,
        );
        return webJson(201, HostedProjectCreatedResponseSchema, {
          project: options.database.createProject(
            user.id,
            input.name,
            input.game,
          ),
        });
      },
    ),
    defineWebRoute(
      "get-project",
      "GET",
      /^\/api\/projects\/([^/]+)$/,
      (context, match) => {
        const user = requireWebUser(context, options.database);
        const project = options.database.project(
          pathParameter(match, 0),
          user.id,
        );
        if (!project) return webError(404, "Project not found");
        return webJson(200, HostedProjectResponseSchema, {
          project: { ...project, maps: [...project.maps] },
        });
      },
    ),
    defineWebRoute(
      "list-project-members",
      "GET",
      /^\/api\/projects\/([^/]+)\/members$/,
      (context, match) => {
        const user = requireWebUser(context, options.database);
        const users = options.database.listProjectAccess(
          pathParameter(match, 0),
          user.id,
        );
        if (!users) return webError(403, "Project owner access required");
        return webJson(200, HostedProjectMembersResponseSchema, {
          users: [...users],
        });
      },
    ),
    defineWebRoute(
      "set-project-member-role",
      "PUT",
      /^\/api\/projects\/([^/]+)\/members\/([^/]+)$/,
      async (context, match) => {
        const denied = rejectCrossOriginMutation(context);
        if (denied) return denied;
        const user = requireWebUser(context, options.database);
        const input = await webRequestBody(
          context.request,
          SetProjectMemberRoleRequestSchema,
        );
        const updated = options.database.setProjectMemberRole(
          pathParameter(match, 0),
          user.id,
          pathParameter(match, 1),
          input.role,
        );
        return updated
          ? webOk()
          : webError(403, "Project owner access required");
      },
    ),
    defineWebRoute(
      "remove-project-member",
      "DELETE",
      /^\/api\/projects\/([^/]+)\/members\/([^/]+)$/,
      (context, match) => {
        const denied = rejectCrossOriginMutation(context);
        if (denied) return denied;
        const user = requireWebUser(context, options.database);
        const removed = options.database.removeProjectMember(
          pathParameter(match, 0),
          user.id,
          pathParameter(match, 1),
        );
        return removed
          ? webOk()
          : webError(403, "Project owner access required");
      },
    ),
    defineWebRoute(
      "create-map",
      "POST",
      /^\/api\/projects\/([^/]+)\/maps$/,
      async (context, match) => {
        const denied = rejectCrossOriginMutation(context);
        if (denied) return denied;
        const user = requireWebUser(context, options.database);
        const projectId = pathParameter(match, 0);
        if (!canEditProject(options.database.role(projectId, user.id))) {
          return webError(403, "Editor access required");
        }
        const input = await webRequestBody(
          context.request,
          CreateHostedMapRequestSchema,
          MAX_HOSTED_MAP_BYTES + 1024,
        );
        if (options.database.hasMapNamed(projectId, input.name)) {
          return webError(409, "A map with this name already exists");
        }
        const mapId = options.database.createMapId();
        const snapshot = await options.maps.initialize(
          mapId,
          input.source ?? EMPTY_MAP,
        );
        const map = options.database.createMap({
          id: mapId,
          projectId,
          userId: user.id,
          name: input.name,
          format: input.format,
        });
        return webJson(201, HostedMapCreatedResponseSchema, {
          map: { ...map, ...snapshot },
        });
      },
    ),
  ] as const;
}
