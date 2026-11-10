import { Elysia } from "elysia";
import type { Db } from "../db";
import { authenticateBearer } from "../services/request-auth";
import { createCentralBearerAuth } from "../services/request-auth";
import { IdentityError } from "@tea/identity";
import type { Config } from "../config";

type BearerAuthOptions = {
  unauthorizedBody?: Record<string, unknown>;
  resourceMetadata?: string;
  expectedAudience?: string;
  config?: Config;
};

export function bearerAuth(db: Db, options: BearerAuthOptions = {}) {
  const central = options.config?.identity
    ? createCentralBearerAuth(db, options.config)
    : null;
  return new Elysia({ name: "bearer-auth" }).macro({
    authenticated: {
      async resolve({ request, set, status }) {
        let principal;
        try {
          principal = central
            ? await central(request)
            : authenticateBearer(db, request, options.expectedAudience);
        } catch (error) {
          const code = error instanceof IdentityError ? error.status : 503;
          if (options.resourceMetadata && code === 401)
            set.headers["www-authenticate"] =
              `Bearer resource_metadata="${options.resourceMetadata}"`;
          return status(
            code,
            options.unauthorizedBody ?? {
              error:
                code === 503 ? "Identity service unavailable" : "Unauthorized",
            },
          );
        }
        if (!principal) {
          if (options.resourceMetadata) {
            set.headers["www-authenticate"] =
              `Bearer resource_metadata="${options.resourceMetadata}"`;
          }
          return status(
            401,
            options.unauthorizedBody ?? { error: "Unauthorized" },
          );
        }
        return { principal };
      },
    },
  });
}
