import application from "../worker.ts";
import type { Bindings } from "../app/runtime.ts";
import { cliLoopbackTransport } from "./cli-loopback-transport.ts";
export { CommunityCell, CommunityPublicDirectory } from "../worker.ts";
const networkFetch = globalThis.fetch;
export default {
  fetch(
    request: Request,
    env: Bindings & { CLI_FIXTURE_ORIGIN: string },
    context: ExecutionContext,
  ) {
    globalThis.fetch = cliLoopbackTransport(
      networkFetch,
      env.CLI_FIXTURE_ORIGIN,
    );
    return application.fetch(request, env, context);
  },
};
