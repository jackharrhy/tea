import type { Middleware } from "remix/router";
import { json } from "./security.ts";

export function limitConcurrency(maxConcurrent: number): Middleware {
  let active = 0;
  return async (_context, next) => {
    if (active >= maxConcurrent)
      return json({ error: "busy" }, 429, { "retry-after": "1" });
    active++;
    try {
      return await next();
    } finally {
      active--;
    }
  };
}
