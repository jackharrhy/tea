import { treaty } from "@elysiajs/eden";
import type { App } from "../server/index";

export const eden = treaty<App>(
  typeof window === "undefined" ? "http://localhost" : window.location.origin,
);
