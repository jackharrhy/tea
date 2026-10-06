import type { Middleware } from "remix/router";
import { createContextKey } from "remix/router";
import { createLog, currentLog, type Log, type Logger } from "./index.ts";

declare module "remix/router" {
  interface RequestContext {
    log: Log;
  }
}

export const CurrentLog: { defaultValue?: Log } = createContextKey<Log>();
const LOG_PROPERTY = { property: "log" } as const;

export function log(
  logger?: Logger,
): Middleware<{ key: typeof CurrentLog; value: Log; property: "log" }> {
  return async (context, next) => {
    const current = currentLog();
    const active =
      current ?? logger?.open("request") ?? createLog({ kind: "request" });
    context.set(CurrentLog, active, LOG_PROPERTY);
    active.set({ http: { method: context.method } });

    const handle = async () => {
      const response = await next();
      active.set({ http: { status: response.status } });
      return response;
    };
    return current ? handle() : active.run(handle);
  };
}
