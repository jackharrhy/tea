import { createController } from "remix/router";
import { route, get, post } from "remix/routes";
import { renderToString } from "remix/component/server";
import { CommunityError } from "./data/community.ts";
import type { Row } from "./data/community.ts";
import type { Runtime, Viewer } from "./runtime.ts";
import { wantsJSON } from "./http.ts";
export const pushRoutes = route({
  subscribe: post("/api/push/subscribe"),
  unsubscribe: post("/api/push/unsubscribe"),
  devices: get("/api/push/devices"),
  remove: post("/api/push/devices/:id/delete"),
});
function deviceTime(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value).replace(" ", "T").replace(/Z?$/, "Z"));
  const iso = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  return (
    <time datetime={iso} data-fmt="full">
      {iso.slice(0, 16).replace("T", " ")}
    </time>
  );
}
async function pushDevicesHTML(devices: Row[]) {
  return renderToString(
    devices.length ? (
      <div class="stack">
        {devices.map((d) => (
          <div class="fourm-actions">
            <strong>{d.device_name || String(d.device_id).slice(0, 12)}</strong>{" "}
            <span class="muted">{deviceTime(d.created_at)}</span>{" "}
            <form
              method="post"
              action={`/api/push/devices/${d.id}/delete`}
              class="inline"
              hx-post={`/api/push/devices/${d.id}/delete`}
              hx-target="#push-devices"
              hx-swap="innerHTML"
              hx-confirm="remove this device?"
            >
              <button type="submit" class="btn-sm">
                remove
              </button>
            </form>
          </div>
        ))}
      </div>
    ) : (
      <p class="muted">no devices registered</p>
    ),
  );
}
export function pushController(store: Runtime, viewer: Viewer) {
  function actor() {
    if (!viewer.member) throw new CommunityError(401, "Sign in to continue");
    return viewer.member.id;
  }
  async function devices(request: Request) {
    const rows = await store.call("pushDevices", actor());
    return wantsJSON(request)
      ? Response.json(rows)
      : new Response(await pushDevicesHTML(rows), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
  }
  return createController(pushRoutes, {
    actions: {
      async subscribe({ request }) {
        const id = actor();
        await store.call("subscribePush", id, await request.json());
        return Response.json({ ok: true });
      },
      async unsubscribe({ request }) {
        const id = actor();
        const body = (await request.json()) as { device_id?: unknown };
        if (typeof body?.device_id !== "string")
          throw new CommunityError(400, "device_id required");
        await store.call("unsubscribePush", id, body.device_id);
        return Response.json({ ok: true });
      },
      devices({ request }) {
        return devices(request);
      },
      async remove({ request, params }) {
        if (!/^\d+$/.test(params.id))
          throw new CommunityError(422, "Invalid device id");
        await store.call("deletePushDevice", actor(), Number(params.id));
        return request.headers.get("HX-Request") === "true"
          ? devices(request)
          : Response.json({ ok: true });
      },
    },
  });
}
