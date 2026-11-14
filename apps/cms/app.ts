import { existsSync } from "node:fs";
import { constants } from "node:zlib";
import { join } from "node:path";
import type { SiteRuntime } from "./app/site.ts";
import { openDatabase } from "./app/data/database.ts";
import { transaction } from "./app/data/transaction.ts";
import { createTeaRouter } from "./app/router.ts";
import { createOperatorRouter } from "./operator/router.tsx";
import type { OperatorStore } from "./operator/store.ts";
import { currentLog } from "@harrhy/logger";
import { parseOperatorOrigin } from "./config.ts";
import { compressResponse } from "remix/response/compress";
import type { BackupStatus } from "./backup/service.ts";

type Operator = { origin: string; store: OperatorStore };
type Tenant = {
  site: SiteRuntime;
  origin: URL;
  database: Awaited<ReturnType<typeof openDatabase>>;
  router: ReturnType<typeof createTeaRouter>;
};

async function openTenant(
  site: SiteRuntime,
  operator?: Operator,
): Promise<Tenant> {
  const path = join(site.dataDir, "tea.db");
  const fresh = !existsSync(path);
  const database = await openDatabase(path);
  try {
    if (fresh)
      transaction(database.sqlite, () => {
        database.sqlite
          .prepare("UPDATE site_preferences SET site_name=?,canonical_origin=?")
          .run(site.name, site.origin);
        database.sqlite
          .prepare("UPDATE site SET background_color=?")
          .run(site.definition.background);
      });
    return {
      site,
      origin: new URL(site.origin),
      database,
      router: createTeaRouter(
        database,
        site,
        operator?.store,
        operator?.origin,
      ),
    };
  } catch (error) {
    database.sqlite.close();
    throw error;
  }
}

export async function createApp(
  sites: SiteRuntime[],
  operator?: Operator,
  backupStatus?: () => BackupStatus,
) {
  const tenants: Tenant[] = [];
  try {
    if (operator) parseOperatorOrigin(operator.origin, sites);
    for (const site of sites) tenants.push(await openTenant(site, operator));
    const byHost = new Map(
      tenants.flatMap((tenant) =>
        [tenant.origin.host, ...tenant.site.aliases].map(
          (host) => [host, tenant] as const,
        ),
      ),
    );
    const operatorRoute = operator && {
      origin: new URL(operator.origin),
      router: createOperatorRouter(
        operator.store,
        operator.origin,
        tenants,
        backupStatus,
      ),
    };
    return {
      async fetch(request: Request) {
        const url = new URL(request.url),
          tenant = byHost.get(url.host);
        if (operatorRoute && url.host === operatorRoute.origin.host) {
          currentLog()?.set({ app: { area: "operator" } });
          url.protocol = operatorRoute.origin.protocol;
          return operatorRoute.router.fetch(new Request(url, request));
        }
        if (!tenant) return new Response("Unknown site", { status: 404 });
        currentLog()?.set({ site: { id: tenant.site.id } });
        const origin = new URL(tenant.origin);
        if (url.host !== origin.host) {
          origin.pathname = url.pathname;
          origin.search = url.search;
          return new Response(null, {
            status: 308,
            headers: { Location: origin.href },
          });
        }
        // Use the registered origin behind TLS termination, never forwarded host headers.
        url.protocol = origin.protocol;
        const response = await tenant.router.fetch(new Request(url, request));
        if (
          (request.method === "GET" || request.method === "HEAD") &&
          !url.search &&
          !url.pathname.startsWith("/tea/") &&
          !request.headers.has("cookie") &&
          !request.headers.has("authorization") &&
          !response.headers.has("set-cookie") &&
          response.headers.get("content-type")?.startsWith("text/html")
        )
          return compressResponse(response, request, {
            encodings: ["br", "gzip"],
            brotli: { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } },
          });
        return response;
      },
      close() {
        for (const tenant of tenants) tenant.database.sqlite.close();
        operator?.store.close();
      },
    };
  } catch (error) {
    for (const tenant of tenants) tenant.database.sqlite.close();
    operator?.store.close();
    throw error;
  }
}
