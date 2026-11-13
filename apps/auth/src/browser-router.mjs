import { createRouter } from "remix/router";
import { route } from "remix/routes";

const routes = route({ root: "/", rest: "/*path" });

export function createBrowserRouter(handle) {
  const router = createRouter();
  router.map(routes, {
    actions: {
      root({ request }) {
        return handle(request);
      },
      rest({ request }) {
        return handle(request);
      },
    },
  });
  return router;
}
