import { RadioRoomCell } from "./app/data/radio-room-cell.ts";
import { RoomDirectoryCell } from "./app/data/room-directory-cell.ts";
import { createRadioRuntime } from "./app/data/worker-radio-runtime.ts";
import { createAppRouter } from "./app/router.ts";

export { RadioRoomCell, RoomDirectoryCell };

export default {
  async fetch(request, env): Promise<Response> {
    try {
      if (
        !env.AUTH_ISSUER ||
        !env.AUTH_CLIENT_ID ||
        !env.AUTH_PROJECT_ID ||
        !env.AUTH_ORGANIZATION_ID ||
        !env.AUTH_PUBLIC_ORIGIN
      )
        throw new Error("Central Auth configuration is incomplete");
      let router = createAppRouter(createRadioRuntime(env), {
        identity: {
          issuer: env.AUTH_ISSUER,
          clientId: env.AUTH_CLIENT_ID,
          projectId: env.AUTH_PROJECT_ID,
          organizationId: env.AUTH_ORGANIZATION_ID,
        },
        publicOrigin: env.AUTH_PUBLIC_ORIGIN,
        sessionSecret: env.RADIO_SESSION_SECRET,
        secureCookies: new URL(request.url).protocol === "https:",
      });
      let response = await router.fetch(request);
      if (response.status !== 404) return response;
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(
        JSON.stringify({ event: "request_failed", error: errorMessage(error) }),
      );
      return new Response("Internal Server Error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}
