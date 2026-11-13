import { createRouter } from "remix/router";
import { route } from "remix/routes";

const routes = route({
  login: "/login",
  logout: "/logout",
  account: "/account",
  email: "/account/email",
  password: "/account/password",
  resendEmail: "/account/email/resend",
  authorize: "/authorize",
  device: "/device",
  verifyEmail: "/verify-email",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  apps: "/apps/:id",
  sessions: "/account/sessions",
  endSession: "/account/sessions/end",
  manage: "/manage",
  manageRest: "/manage/*path",
  supportStart: "/manage/people/:id/support",
  supportHandoff: "/support/handoff",
  supportCallback: "/support/callback",
  root: "/",
  rest: "/*path",
});

export function createBrowserRouter(
  handle,
  {
    accountRoutes,
    oauthRoutes,
    emailRoutes,
    accessRoutes,
    supportRoutes,
    loginRoutes,
  },
) {
  const router = createRouter();
  router.map(routes, {
    actions: {
      login({ request }) {
        return handle(request, loginRoutes.login, "public");
      },
      logout({ request }) {
        return handle(request, loginRoutes.logout, "public");
      },
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
      verifyEmail({ request }) {
        return handle(request, emailRoutes.verifyEmail, "public");
      },
      forgotPassword({ request }) {
        return handle(request, emailRoutes.forgotPassword, "public");
      },
      resetPassword({ request }) {
        return handle(request, emailRoutes.resetPassword, "public");
      },
      apps({ request }) {
        return handle(request, accessRoutes);
      },
      sessions({ request }) {
        return handle(request, accessRoutes);
      },
      endSession({ request }) {
        return handle(request, accessRoutes);
      },
      manage({ request }) {
        return handle(request, accessRoutes);
      },
      manageRest({ request }) {
        return handle(request, accessRoutes);
      },
      supportStart({ request }) {
        return handle(request, supportRoutes);
      },
      supportHandoff({ request }) {
        return handle(request, supportRoutes);
      },
      supportCallback({ request }) {
        return handle(request, supportRoutes);
      },
      root({ request }) {
        return handle(request, accessRoutes);
      },
      rest({ request }) {
        return handle(request);
      },
    },
  });
  return router;
}
