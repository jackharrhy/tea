import { BackupList } from "./admin-backups.tsx";
import { scanStorage } from "./storage-health.ts";
import { StorageHealthView } from "./admin-storage.tsx";
import type { Row } from "./data/community.ts";
import { renderToString } from "remix/component/server";
import { AdminUserRow } from "./admin-users.tsx";
import { CommunityError } from "./data/community.ts";
import { createController } from "remix/router";
import { route, post, get } from "remix/routes";
import type { Runtime, Viewer, Bindings } from "./runtime.ts";
import { formFields, saved } from "./settings-controller.tsx";
export const adminRoutes = route({
  backups: get("/admin/backups"),
  runBackup: post("/admin/backups/run"),
  cleanupFiles: post("/admin/cleanup/files"),
  cleanupRecords: post("/admin/cleanup/records"),
  orphans: get("/admin/orphans"),
  banner: post("/admin/site-banner"),
  randomize: post("/admin/cards/randomize-default-colors"),
  deleteAccount: post("/admin/users/:id/delete"),
  rename: post("/admin/users/:id/rename"),
  toggleAdmin: post("/admin/users/:id/toggle-admin"),
  toggleDisabled: post("/admin/users/:id/toggle-disabled"),
  webring: post("/admin/users/:id/toggle-webring"),
  identity: post("/admin/users/:id/identity"),
  profile: post("/admin/users/:id/profile"),
  card: post("/admin/users/:id/card"),
  page: post("/admin/pages/:id"),
});
const redirect = () =>
  new Response(null, { status: 303, headers: { Location: "/admin" } });
function integer(value: string) {
  if (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new CommunityError(422, "Invalid ID");
  return Number(value);
}
async function rowResponse(request: Request, row: { user: Row; stats: Row }) {
  return request.headers.get("HX-Request") === "true"
    ? new Response(await renderToString(<AdminUserRow {...row} open />), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    : redirect();
}
function cleanupResponse(
  request: Request,
  count: number,
  kind: "files" | "records",
) {
  return request.headers.get("HX-Request") === "true"
    ? new Response(
        `<p class="ok">deleted ${count} orphaned ${kind === "files" ? "file(s)" : "record(s)"}.</p>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      )
    : new Response(null, {
        status: 303,
        headers: { Location: `/admin?cleaned_${kind}=${count}` },
      });
}
export function adminController(store: Runtime, viewer: Viewer, env: Bindings) {
  const id = viewer.member?.id ?? null;
  return createController(adminRoutes, {
    actions: {
      async backups() {
        const status = await store.call("backupStatus", id);
        return new Response(await renderToString(<BackupList {...status} />), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
      async runBackup({ request }) {
        const cell = env.COMMUNITIES.get(
          env.COMMUNITIES.idFromName("fourm-community-v1"),
        );
        const result = await cell.runBackup(id);
        if (!result.ok) throw new CommunityError(result.status, result.error);
        if (request.headers.get("HX-Request") !== "true") return redirect();
        const run = result.result;
        return new Response(
          await renderToString(
            <p class={run.error ? "error" : "ok"}>
              {run.error
                ? `error: ${run.error}`
                : `backup complete: ${run.name}`}
            </p>,
          ),
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      },
      async cleanupFiles({ request }) {
        const count = await store.cleanupOrphanFiles(id);
        return cleanupResponse(request, count, "files");
      },
      async cleanupRecords({ request }) {
        const count = await store.cleanupMissingMediaRecords(id);
        return cleanupResponse(request, count, "records");
      },
      async orphans() {
        const result = await scanStorage(env.MEDIA, () =>
          store.call("adminMediaInventory", id),
        );
        return new Response(
          await renderToString(<StorageHealthView {...result} />),
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      },
      async randomize() {
        const count = await store.call("adminRandomizeCards", id);
        return new Response(null, {
          status: 303,
          headers: { Location: `/admin?randomized_cards=${count}` },
        });
      },
      async deleteAccount({ request, params }) {
        const fields = await formFields(request);
        const count = await store.deleteAccount(
          id,
          integer(params.id),
          String(fields.mode ?? "reparent"),
        );
        return request.headers.get("HX-Request") === "true"
          ? new Response(
              `<tr><td colspan='8'>deleted ${count} user(s)</td></tr>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          : redirect();
      },
      async rename({ request, params }) {
        const fields = await formFields(request);
        const userId = integer(params.id);
        if (id === null) throw new CommunityError(403, "Admin access required");
        await store.call("adminUserRow", id, userId);
        try {
          await store.adminRenameUsername(
            id,
            userId,
            String(fields.new_username ?? ""),
            String(fields.new_display_name ?? ""),
          );
        } catch (error) {
          if (
            !(error instanceof CommunityError) ||
            ![422, 409].includes(error.status)
          )
            throw error;
          if (error.status === 409 && !error.message.includes("already taken"))
            throw error;
          return request.headers.get("HX-Request") === "true"
            ? new Response(
                `<tr><td colspan="8" class="error">${error.status === 422 ? "invalid username" : "username taken"}</td></tr>`,
                {
                  status: 400,
                  headers: { "Content-Type": "text/html; charset=utf-8" },
                },
              )
            : redirect();
        }
        return rowResponse(
          request,
          await store.call("adminUserRow", id, userId),
        );
      },
      async toggleAdmin({ request, params }) {
        return rowResponse(
          request,
          await store.call(
            "adminToggleAccount",
            id,
            integer(params.id),
            "is_admin",
          ),
        );
      },
      async toggleDisabled({ request, params }) {
        return rowResponse(
          request,
          await store.call(
            "adminToggleAccount",
            id,
            integer(params.id),
            "is_disabled",
          ),
        );
      },
      async webring({ request, params }) {
        const fields = await formFields(request);
        return rowResponse(
          request,
          await store.call(
            "adminSetWebring",
            id,
            integer(params.id),
            fields.in_webring === "on",
          ),
        );
      },
      async identity({ request, params }) {
        const subject = await store.call(
          "adminIdentitySubject",
          id,
          integer(params.id),
          env.AUTH_ISSUER,
        );
        const destination =
          env.AUTH_ISSUER +
          "/manage/users/" +
          encodeURIComponent(subject).replace(
            /[!'()*]/g,
            (character) =>
              "%" + character.charCodeAt(0).toString(16).toUpperCase(),
          );
        return request.headers.get("HX-Request") === "true"
          ? new Response(null, { headers: { "HX-Redirect": destination } })
          : new Response(null, {
              status: 303,
              headers: { Location: destination },
            });
      },
      async banner({ request }) {
        await store.call("adminSaveBanner", id, await formFields(request));
        return redirect();
      },
      async profile({ request, params }) {
        await store.call(
          "adminSaveProfile",
          id,
          integer(params.id),
          await formFields(request),
        );
        return saved(request);
      },
      async card({ request, params }) {
        await store.call(
          "adminSaveCard",
          id,
          integer(params.id),
          await formFields(request),
        );
        return redirect();
      },
      async page({ request, params }) {
        await store.call(
          "adminSavePage",
          id,
          integer(params.id),
          await formFields(request),
        );
        return redirect();
      },
    },
  });
}
