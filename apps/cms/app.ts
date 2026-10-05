import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SiteRuntime } from "@tea/cms-core/site.ts";
import { openDatabase } from "@tea/cms-core/data/database.ts";
import { transaction } from "@tea/cms-core/data/transaction.ts";
import { createTeaRouter } from "@tea/cms-core/router.ts";
import { createOperatorRouter } from "@tea/cms-operator/router.tsx";
import type { OperatorStore } from "@tea/cms-operator/store.ts";
import { parseOperatorOrigin } from "./config.ts";

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

export async function createApp(sites: SiteRuntime[], operator?: Operator) {
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
      router: createOperatorRouter(operator.store, operator.origin, tenants),
    };
    return {
      async fetch(request: Request) {
        const url = new URL(request.url),
          tenant = byHost.get(url.host);
        if (operatorRoute && url.host === operatorRoute.origin.host) {
          url.protocol = operatorRoute.origin.protocol;
          return operatorRoute.router.fetch(new Request(url, request));
        }
        if (!tenant) return new Response("Unknown site", { status: 404 });
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
        return tenant.router.fetch(new Request(url, request));
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
