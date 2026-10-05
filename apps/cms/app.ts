import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SiteRuntime } from "@tea/cms-core/site.ts";
import { openDatabase } from "@tea/cms-core/data/database.ts";
import { transaction } from "@tea/cms-core/data/transaction.ts";
import { createTeaRouter } from "@tea/cms-core/router.ts";
import { createOperatorRouter } from "@tea/cms-operator/router.tsx";
import type { OperatorStore } from "@tea/cms-operator/store.ts";

export async function createApp(
  sites: SiteRuntime[],
  operator?: { origin: string; store: OperatorStore },
) {
  if (
    operator &&
    sites.some((site) =>
      [new URL(site.origin).host, ...site.aliases].includes(
        new URL(operator.origin).host,
      ),
    )
  )
    throw new Error("Operator origin overlaps a site hostname.");
  const tenants: {
    site: SiteRuntime;
    database: Awaited<ReturnType<typeof openDatabase>>;
    router: ReturnType<typeof createTeaRouter>;
  }[] = [];
  try {
    for (const site of sites) {
      const path = join(site.dataDir, "tea.db"),
        fresh = !existsSync(path);
      const database = await openDatabase(path);
      try {
        if (fresh)
          transaction(database.sqlite, () => {
            database.sqlite
              .prepare(
                "UPDATE site_preferences SET site_name=?,canonical_origin=?",
              )
              .run(site.name, site.origin);
            database.sqlite
              .prepare("UPDATE site SET background_color=?")
              .run(site.definition.background);
          });
        tenants.push({
          site,
          database,
          router: createTeaRouter(
            database,
            site,
            operator?.store,
            operator?.origin,
          ),
        });
      } catch (error) {
        database.sqlite.close();
        throw error;
      }
    }
  } catch (error) {
    for (const t of tenants) t.database.sqlite.close();
    throw error;
  }
  const byHost = new Map(
    tenants.flatMap((t) =>
      [new URL(t.site.origin).host, ...t.site.aliases].map(
        (host) => [host, t] as const,
      ),
    ),
  );
  const operatorRouter = operator
    ? createOperatorRouter(operator.store, operator.origin, tenants)
    : null;
  return {
    async fetch(request: Request) {
      const url = new URL(request.url),
        tenant = byHost.get(url.host);
      if (operator && url.host === new URL(operator.origin).host) {
        url.protocol = new URL(operator.origin).protocol;
        return operatorRouter!.fetch(new Request(url, request));
      }
      if (!tenant) return new Response("Unknown site", { status: 404 });
      const origin = new URL(tenant.site.origin);
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
      for (const t of tenants) t.database.sqlite.close();
      operator?.store.close();
    },
  };
}
