import { RadioRoomCell } from "./app/data/radio-room-cell.ts";
import { RoomDirectoryCell } from "./app/data/room-directory-cell.ts";
import { createRadioRuntime } from "./app/data/worker-radio-runtime.ts";
import { createAppRouter } from "./app/router.ts";

export { RadioRoomCell, RoomDirectoryCell };

export default {
  async fetch(request, env): Promise<Response> {
    try {
      let router = createAppRouter(createRadioRuntime(env), {
        password: env.RADIO_PASSWORD,
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
