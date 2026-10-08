import { createController } from "remix/router";
import { css } from "remix/component";

import {
  getClearSessionCookie,
  isDevelopmentAuthEnabled,
  logout,
  parseSessionCookie,
} from "#lib/auth.server";

import { requireUser } from "../../middleware/auth.ts";
import { routes } from "../../routes.ts";
import { Page } from "../../ui/page.tsx";
import {
  Alert,
  Button,
  ButtonLink,
  Detail,
  DetailList,
  PageHeader,
  Panel,
  SectionHeader,
} from "../../ui/primitives.tsx";
import { narrowPageStyle } from "../../ui/styles.ts";

const sectionStyle = css({ marginBottom: "2rem" });
const topMarginStyle = css({ marginTop: "1rem" });

export default createController(routes.settings, {
  middleware: [requireUser()],
  actions: {
    index(context) {
      const user = context.user;
      if (!user) return new Response("Unauthorized", { status: 401 });
      const developmentAuth = isDevelopmentAuthEnabled();

      return context.render(
        <Page title="Settings - artbin" user={user}>
          <main mix={narrowPageStyle}>
            <PageHeader
              title="Settings"
              description="Manage your account and administrative access."
            />
            <section mix={sectionStyle}>
              <SectionHeader title="Account" />
              <Panel>
                <DetailList>
                  <Detail label="Username">@{user.username}</Detail>
                </DetailList>
                {developmentAuth ? (
                  <div mix={topMarginStyle}>
                    <Alert tone="info">
                      Local development mode is active. Authentication is
                      disabled.
                    </Alert>
                  </div>
                ) : (
                  <form
                    method="post"
                    action={routes.settings.action.href()}
                    mix={topMarginStyle}
                  >
                    <input type="hidden" name="intent" value="logout" />
                    <Button type="submit" variant="danger" size="small">
                      Logout
                    </Button>
                  </form>
                )}
              </Panel>
            </section>
            {user.isAdmin ? (
              <section mix={sectionStyle}>
                <SectionHeader title="Admin" />
                <Panel>
                  <ButtonLink
                    href={routes.admin.index.href()}
                    variant="primary"
                    size="small"
                  >
                    Admin panel
                  </ButtonLink>
                </Panel>
              </section>
            ) : null}
          </main>
        </Page>,
      );
    },

    async action(context) {
      const formData = await context.request.formData();
      if (formData.get("intent") !== "logout") {
        return new Response("Unknown settings action", { status: 400 });
      }

      const sessionId = parseSessionCookie(
        context.request.headers.get("Cookie"),
      );
      if (sessionId) await logout(sessionId);

      const headers = new Headers({
        Location: routes.home.href(),
        "Set-Cookie": getClearSessionCookie(),
      });
      return new Response(null, { status: 303, headers });
    },
  },
});
