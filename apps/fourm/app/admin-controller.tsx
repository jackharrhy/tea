import { CommunityError } from "./data/community.ts";
import { createController } from "remix/router";
import { route, post } from "remix/routes";
import type { Runtime, Viewer } from "./runtime.ts";
import { formFields, saved } from "./settings-controller.tsx";
export const adminRoutes = route({
  banner: post("/admin/site-banner"),
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
export function adminController(store: Runtime, viewer: Viewer) {
  const id = viewer.member?.id ?? null;
  return createController(adminRoutes, {
    actions: {
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
