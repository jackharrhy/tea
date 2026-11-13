import { createRouter } from "remix/router";
import { route } from "remix/routes";

const routes = route({
  account: "/account",
  email: "/account/email",
  password: "/account/password",
  resendEmail: "/account/email/resend",
  authorize: "/authorize",
  device: "/device",
  root: "/",
  rest: "/*path",
});

export function createBrowserRouter(handle, accountRoutes, oauthRoutes) {
  const router = createRouter();
  router.map(routes, {
    actions: {
      account({ request }) {
        return handle(request, accountRoutes.account);
      },
      email({ request }) {
        return handle(request, accountRoutes.email);
      },
      password({ request }) {
        return handle(request, accountRoutes.password);
      },
      resendEmail({ request }) {
        return handle(request, accountRoutes.resendEmail);
      },
      authorize({ request }) {
        return handle(request, oauthRoutes.authorize);
      },
      device({ request }) {
        return handle(request, oauthRoutes.device);
      },
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
