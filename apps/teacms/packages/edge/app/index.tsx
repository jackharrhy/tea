import {
  createController,
  createRouter,
  type MiddlewareContext,
  type Router,
} from "remix/router";
import { render as remixRender } from "remix/middleware/render";
import { routes } from "./routes.ts";
import {
  clearedSessionCookie,
  isEditor,
  passwordMatches,
  previewAllowed,
  requireSecrets,
  sameOrigin,
  sessionCookie,
} from "./auth.ts";
import {
  getEntry,
  listEntries,
  parseFields,
  publishDraft,
  saveDraft,
  validSlug,
} from "./entries.ts";
import {
  CollectionPage,
  CollectionsPage,
  EntryPage,
  HistoryPage,
  LoginPage,
  MediaPage,
} from "./ui.tsx";
import { createPreviewToken } from "./preview.ts";
import type { Bindings, Collection, EdgeConfig } from "./types.ts";

export type {
  Bindings,
  Collection,
  EdgeConfig,
  Entry,
  Field,
} from "./types.ts";
export { routes } from "./routes.ts";

const renderMiddleware = remixRender();
export type EdgeContext = MiddlewareContext<[typeof renderMiddleware]>;

function redirect(location: string, cookie?: string) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function collectionFor(
  config: EdgeConfig,
  name: string,
): Collection | undefined {
  return config.collections.find((item) => item.name === name);
}

function formNumber(value: FormDataEntryValue | null) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : -1;
}

export function createEdgeRouter(
  env: Bindings,
  config: EdgeConfig,
  extend?: (router: Router<EdgeContext>) => void,
) {
  requireSecrets(env, !config.auth);
  const router = createRouter<EdgeContext>({ middleware: [renderMiddleware] });

  router.map(
    routes,
    createController<typeof routes, EdgeContext>(routes, {
      actions: {
        health: () => json({ ok: true }),
        async mediaFile({ params }) {
          const row = await env.DB.prepare(
            "SELECT * FROM tea_media WHERE id = ?",
          )
            .bind(params.id)
            .first<{ content_type: string }>();
          if (!row) return new Response("Not found", { status: 404 });
          const object = await env.MEDIA.get(`media/${params.id}`);
          if (!object) return new Response("Not found", { status: 404 });
          return new Response(object.body, {
            headers: {
              "Content-Type": row.content_type,
              "Cache-Control": "public, max-age=3600",
              "X-Content-Type-Options": "nosniff",
            },
          });
        },
      },
    }),
  );

  router.map(
    routes.published,
    createController<typeof routes.published, EdgeContext>(routes.published, {
      actions: {
        async list({ params }) {
          if (!collectionFor(config, params.collection))
            return json({ error: "Unknown collection" }, 404);
          return json({
            entries: await listEntries(env.DB, params.collection),
          });
        },
        async entry({ params }) {
          if (
            !collectionFor(config, params.collection) ||
            !validSlug(params.slug)
          )
            return json({ error: "Not found" }, 404);
          const entry = await getEntry(env.DB, params.collection, params.slug);
          return entry ? json(entry) : json({ error: "Not found" }, 404);
        },
      },
    }),
  );

  router.map(
    routes.preview,
    createController<typeof routes.preview, EdgeContext>(routes.preview, {
      actions: {
        async list({ params }) {
          if (!collectionFor(config, params.collection))
            return json({ error: "Unknown collection" }, 404);
          return json({
            entries: await listEntries(env.DB, params.collection, true),
          });
        },
        async entry({ params }) {
          if (
            !collectionFor(config, params.collection) ||
            !validSlug(params.slug)
          )
            return json({ error: "Not found" }, 404);
          const entry = await getEntry(
            env.DB,
            params.collection,
            params.slug,
            true,
          );
          return entry ? json(entry) : json({ error: "Not found" }, 404);
        },
      },
    }),
  );

  router.map(
    routes.auth,
    createController<typeof routes.auth, EdgeContext>(routes.auth, {
      actions: {
        async login({ request, render }) {
          if (config.auth) return redirect(config.auth.loginPath);
          if (await isEditor(request, env)) return redirect("/tea");
          return render(<LoginPage siteName={config.siteName} />, {
            headers: { "Cache-Control": "no-store" },
          });
        },
        async authenticate({ request, render }) {
          if (config.auth) return redirect(config.auth.loginPath);
          const form = await request.formData();
          if (!(await passwordMatches(String(form.get("password") ?? ""), env)))
            return render(
              <LoginPage siteName={config.siteName} error="Wrong password." />,
              { status: 401, headers: { "Cache-Control": "no-store" } },
            );
          return redirect("/tea", await sessionCookie(request, env));
        },
        logout: ({ request }) =>
          config.auth
            ? config.auth.logout(request)
            : redirect("/tea/login", clearedSessionCookie()),
      },
    }),
  );

  router.map(
    routes.admin,
    createController<typeof routes.admin, EdgeContext>(routes.admin, {
      actions: {
        async index({ request, render }) {
          const links =
            typeof config.adminLinks === "function"
              ? await config.adminLinks(request)
              : config.adminLinks;
          return render(
            <CollectionsPage
              siteName={config.siteName}
              collections={config.collections}
              links={links}
            />,
            { headers: { "Cache-Control": "no-store" } },
          );
        },
        async collection({ params, render }) {
          const collection = collectionFor(config, params.collection);
          if (!collection) return new Response("Not found", { status: 404 });
          const entries = await listEntries(env.DB, collection.name, true);
          return render(
            <CollectionPage
              siteName={config.siteName}
              collection={collection}
              entries={entries}
            />,
            { headers: { "Cache-Control": "no-store" } },
          );
        },
        async newEntry({ params, render }) {
          const collection = collectionFor(config, params.collection);
          if (!collection) return new Response("Not found", { status: 404 });
          const media = await env.DB.prepare(
            "SELECT id, filename FROM tea_media ORDER BY created_at DESC",
          ).all<{ id: string; filename: string }>();
          return render(
            <EntryPage
              siteName={config.siteName}
              collection={collection}
              slug=""
              entry={null}
              media={media.results}
            />,
            { headers: { "Cache-Control": "no-store" } },
          );
        },
        async create({ request, params }) {
          const collection = collectionFor(config, params.collection);
          if (!collection) return new Response("Not found", { status: 404 });
          const form = await request.formData(),
            slug = String(form.get("slug") ?? "");
          const parsed = parseFields(form, collection);
          if ("error" in parsed)
            return new Response(parsed.error, { status: 400 });
          const result = await saveDraft(
            env.DB,
            collection,
            slug,
            parsed.data,
            0,
          );
          return "error" in result
            ? new Response(result.error, { status: result.status })
            : redirect(
                `/tea/${encodeURIComponent(collection.name)}/${encodeURIComponent(slug)}`,
              );
        },
        async edit({ params, render }) {
          const collection = collectionFor(config, params.collection);
          if (!collection) return new Response("Not found", { status: 404 });
          const entry = await getEntry(
            env.DB,
            collection.name,
            params.slug,
            true,
          );
          if (!entry) return new Response("Not found", { status: 404 });
          const media = await env.DB.prepare(
            "SELECT id, filename FROM tea_media ORDER BY created_at DESC",
          ).all<{ id: string; filename: string }>();
          const token = config.previewUrl
            ? await createPreviewToken(
                collection.name,
                params.slug,
                env.TEA_PREVIEW_SECRET,
              )
            : "";
          return render(
            <EntryPage
              siteName={config.siteName}
              collection={collection}
              slug={params.slug}
              entry={entry}
              media={media.results}
              previewUrl={config.previewUrl?.(
                collection.name,
                params.slug,
                token,
              )}
              history={config.entryHistory}
            />,
            { headers: { "Cache-Control": "no-store" } },
          );
        },
        async save({ request, params }) {
          const collection = collectionFor(config, params.collection);
          if (!collection || !validSlug(params.slug))
            return new Response("Not found", { status: 404 });
          const form = await request.formData();
          const parsed = parseFields(form, collection);
          if ("error" in parsed)
            return new Response(parsed.error, { status: 400 });
          const result = await saveDraft(
            env.DB,
            collection,
            params.slug,
            parsed.data,
            formNumber(form.get("revision")),
          );
          return "error" in result
            ? new Response(result.error, { status: result.status })
            : redirect(
                `/tea/${encodeURIComponent(collection.name)}/${encodeURIComponent(params.slug)}`,
              );
        },
        async publish({ request, params }) {
          const collection = collectionFor(config, params.collection);
          if (!collection || !validSlug(params.slug))
            return new Response("Not found", { status: 404 });
          const form = await request.formData();
          const result = await publishDraft(
            env.DB,
            collection.name,
            params.slug,
            formNumber(form.get("revision")),
          );
          if ("error" in result)
            return new Response(result.error, { status: result.status });
          const entry = await getEntry(env.DB, collection.name, params.slug);
          if (entry) await config.afterPublish?.(entry, env);
          return redirect(
            `/tea/${encodeURIComponent(collection.name)}/${encodeURIComponent(params.slug)}`,
          );
        },
        async unpublish({ request, params }) {
          const collection = collectionFor(config, params.collection);
          if (!collection || !validSlug(params.slug))
            return new Response("Not found", { status: 404 });
          const form = await request.formData();
          const result = (await env.DB.prepare(
            "UPDATE tea_entries SET published = NULL, published_at = NULL, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE collection = ? AND slug = ? AND revision = ? AND published IS NOT NULL",
          )
            .bind(
              collection.name,
              params.slug,
              formNumber(form.get("revision")),
            )
            .run()) as { meta?: { changes?: number } };
          return result.meta?.changes
            ? redirect(
                `/tea/${encodeURIComponent(collection.name)}/${encodeURIComponent(params.slug)}`,
              )
            : new Response(
                "Entry changed or is already unpublished. Reload before trying again.",
                { status: 409 },
              );
        },
        async history({ params, render }) {
          const collection = collectionFor(config, params.collection);
          if (!config.entryHistory || !collection || !validSlug(params.slug))
            return new Response("Not found", { status: 404 });
          const entry = await getEntry(
            env.DB,
            collection.name,
            params.slug,
            true,
          );
          if (!entry) return new Response("Not found", { status: 404 });
          const rows = await env.DB.prepare(
            "SELECT revision, changed_at, published_at FROM tea_entry_history WHERE collection = ? AND slug = ? ORDER BY revision DESC LIMIT 100",
          )
            .bind(collection.name, params.slug)
            .all<{
              revision: number;
              changed_at: string;
              published_at: string | null;
            }>();
          return render(
            <HistoryPage
              siteName={config.siteName}
              collection={collection}
              slug={params.slug}
              currentRevision={entry.revision}
              revisions={rows.results}
            />,
            { headers: { "Cache-Control": "no-store" } },
          );
        },
        async restore({ params, request }) {
          const collection = collectionFor(config, params.collection);
          if (!config.entryHistory || !collection || !validSlug(params.slug))
            return new Response("Not found", { status: 404 });
          const form = await request.formData();
          const expected = formNumber(form.get("revision"));
          const sourceRevision = Number(params.revision);
          if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 1)
            return new Response("Not found", { status: 404 });
          const snapshot = await env.DB.prepare(
            "SELECT draft, published FROM tea_entry_history WHERE collection = ? AND slug = ? AND revision = ?",
          )
            .bind(collection.name, params.slug, sourceRevision)
            .first<{ draft: string | null; published: string | null }>();
          const content = snapshot?.draft ?? snapshot?.published;
          if (!content)
            return new Response("Revision not found", { status: 404 });
          const result = (await env.DB.prepare(
            "UPDATE tea_entries SET draft = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE collection = ? AND slug = ? AND revision = ?",
          )
            .bind(content, collection.name, params.slug, expected)
            .run()) as { meta?: { changes?: number } };
          return result.meta?.changes
            ? redirect(
                `/tea/${encodeURIComponent(collection.name)}/${encodeURIComponent(params.slug)}`,
              )
            : new Response(
                "Entry changed in another tab. Reload before restoring.",
                { status: 409 },
              );
        },
        async media({ render }) {
          const rows = await env.DB.prepare(
            "SELECT * FROM tea_media ORDER BY created_at DESC",
          ).all<{ id: string; filename: string; alt: string }>();
          return render(
            <MediaPage siteName={config.siteName} media={rows.results} />,
            { headers: { "Cache-Control": "no-store" } },
          );
        },
        async upload({ request }) {
          const form = await request.formData();
          const file = form.get("file"),
            alt = String(form.get("alt") ?? "").trim();
          if (
            !(file instanceof File) ||
            !alt ||
            file.size > 10 * 1024 * 1024 ||
            !["image/png", "image/jpeg", "image/webp", "image/avif"].includes(
              file.type,
            )
          )
            return new Response(
              "Choose an image under 10 MB and provide alt text.",
              { status: 400 },
            );
          const id = crypto.randomUUID();
          await env.MEDIA.put(`media/${id}`, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type },
          });
          try {
            await env.DB.prepare(
              "INSERT INTO tea_media (id, filename, content_type, size, alt) VALUES (?, ?, ?, ?, ?)",
            )
              .bind(id, file.name.slice(0, 200), file.type, file.size, alt)
              .run();
          } catch (error) {
            await env.MEDIA.delete(`media/${id}`);
            throw error;
          }
          return redirect("/tea/media");
        },
      },
    }),
  );

  router.map(
    routes.visual,
    createController<typeof routes.visual, EdgeContext>(routes.visual, {
      actions: {
        async entry({ params }) {
          const collection = collectionFor(config, params.collection);
          if (!collection || !validSlug(params.slug))
            return json({ error: "Not found" }, 404);
          const entry = await getEntry(
            env.DB,
            collection.name,
            params.slug,
            true,
          );
          if (!entry) return json({ error: "Not found" }, 404);
          return json({
            revision: entry.revision,
            fields: collection.fields
              .filter((field) =>
                ["text", "textarea", "number", "url"].includes(field.type),
              )
              .map((field) => ({
                name: field.name,
                label: field.label,
                value: String(entry.data[field.name] ?? ""),
              })),
          });
        },
        async save({ request, params }) {
          const collection = collectionFor(config, params.collection);
          if (!collection || !validSlug(params.slug))
            return json({ error: "Not found" }, 404);
          if (Number(request.headers.get("content-length") || 0) > 16384)
            return json({ error: "Field is too long" }, 413);
          const raw = await request.text();
          if (raw.length > 16384)
            return json({ error: "Field is too long" }, 413);
          let input: { name?: unknown; value?: unknown; revision?: unknown };
          try {
            input = JSON.parse(raw);
          } catch {
            return json({ error: "Invalid request" }, 400);
          }
          const field = collection.fields.find(
            (item) =>
              item.name === input.name &&
              ["text", "textarea", "number", "url"].includes(item.type),
          );
          if (
            !field ||
            typeof input.value !== "string" ||
            typeof input.revision !== "number" ||
            !Number.isSafeInteger(input.revision)
          )
            return json({ error: "Invalid field" }, 400);
          const entry = await getEntry(
            env.DB,
            collection.name,
            params.slug,
            true,
          );
          if (!entry) return json({ error: "Not found" }, 404);
          const form = new FormData();
          for (const item of collection.fields) {
            const value = entry.data[item.name];
            if (item.type === "boolean") {
              if (value) form.set(item.name, "on");
            } else if (value !== undefined && value !== null)
              form.set(item.name, String(value));
          }
          form.set(field.name, input.value);
          const parsed = parseFields(form, collection);
          if ("error" in parsed) return json({ error: parsed.error }, 400);
          const result = await saveDraft(
            env.DB,
            collection,
            params.slug,
            parsed.data,
            input.revision,
          );
          if ("error" in result)
            return json({ error: result.error }, result.status);
          const token = config.previewUrl
            ? await createPreviewToken(
                collection.name,
                params.slug,
                env.TEA_PREVIEW_SECRET,
              )
            : "";
          return json({
            revision: result.revision,
            previewUrl: config.previewUrl?.(
              collection.name,
              params.slug,
              token,
            ),
          });
        },
      },
    }),
  );

  extend?.(router);
  return {
    router,
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      if (path === "/tea/") return redirect("/tea");
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        !sameOrigin(request, env)
      )
        return new Response("Forbidden", { status: 403 });
      if (path.startsWith("/api/preview/") && !previewAllowed(request, env))
        return new Response("Unauthorized", { status: 401 });
      if (
        (path === "/tea" || path.startsWith("/tea/")) &&
        path !== "/tea/login"
      ) {
        if (config.auth) {
          const access = await config.auth.authorize(request);
          if (access === "login") return redirect(config.auth.loginPath);
          if (access === "forbidden")
            return new Response("Forbidden", { status: 403 });
        } else if (!(await isEditor(request, env))) {
          return redirect("/tea/login");
        }
      }
      return router.fetch(request);
    },
  };
}
