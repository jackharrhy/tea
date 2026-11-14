import application from "../worker.ts";
import type { Bindings } from "../app/runtime.ts";
export { CommunityCell, CommunityPublicDirectory } from "../worker.ts";
const networkFetch = globalThis.fetch;
export default {
  fetch(
    request: Request,
    env: Bindings & { REVIEW_FIXTURE_ORIGIN: string },
    context: ExecutionContext,
  ) {
    const fixture = new URL(env.REVIEW_FIXTURE_ORIGIN);
    if (
      fixture.origin !== env.REVIEW_FIXTURE_ORIGIN ||
      fixture.protocol !== "http:" ||
      fixture.hostname !== "127.0.0.1"
    )
      throw new Error("Private review requires loopback fixture");
    globalThis.fetch = (input, init) => {
      const source = new URL(input instanceof Request ? input.url : input);
      if (source.origin !== env.AUTH_ISSUER)
        throw new Error("Private review denied outbound request");
      const mapped = new URL(fixture);
      mapped.pathname = source.pathname;
      mapped.search = source.search;
      return networkFetch(
        input instanceof Request ? new Request(mapped, input) : mapped,
        init,
      );
    };
    return application.fetch(request, env, context);
  },
};
