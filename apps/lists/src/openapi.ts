import { openapi } from "@elysiajs/openapi";

export function apiOpenApi() {
  return openapi({
    documentation: {
      info: {
        title: "lists API",
        version: "1.0.0",
        description:
          "Scoped API for managing mailing lists, subscribers, campaigns, and deliverability.",
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
        },
      },
    },
  });
}
