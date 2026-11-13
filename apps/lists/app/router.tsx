import { createRouter, type MiddlewareContext } from "remix/router";
import { render } from "remix/middleware/render";
import { htmlCsp, htmlNoStore } from "./html-security.ts";
import { createController } from "remix/router";
import { eq } from "drizzle-orm";

import type { Config } from "../src/config.ts";
import type { Db } from "../src/db/index.ts";
import { schema } from "../src/db/index.ts";
import { createSubscriber } from "../src/services/subscriber.ts";
import { sendSubscriptionConfirmations } from "../src/services/subscription-confirmation.ts";
import {
  confirmSubscriber,
  confirmSubscriberDomain,
  getSubscriberPreferences,
  unsubscribeAll,
  unsubscribeFromList,
  updatePreferences,
} from "../src/services/subscriber.ts";
import {
  ConfirmationSentPage,
  PreferencesPage,
  StatusPage,
  SubscribePage,
} from "./pages.tsx";
import { routes } from "./routes.ts";

const renderMiddleware = render();
export type AppContext = MiddlewareContext<
  [typeof htmlCsp, typeof renderMiddleware]
>;

declare module "remix/router" {
  interface RouterTypes {
    context: AppContext;
  }
}

export function createListsRouter(db: Db, config: Config) {
  const router = createRouter<AppContext>({
    middleware: [htmlNoStore, htmlCsp, renderMiddleware],
  });
  const controller = createController(routes.subscribe, {
    actions: {
      show(context) {
        return context.render(
          <SubscribePage
            lists={db.select().from(schema.lists).all()}
            enabled={config.publicSubscriptionsEnabled ?? true}
          />,
        );
      },
      async submit(context) {
        const lists = db.select().from(schema.lists).all();
        if (config.publicSubscriptionsEnabled === false)
          return new Response("Subscriptions unavailable", { status: 503 });
        const form = await context.request.formData();
        const email = String(form.get("email") ?? "").trim();
        const firstName =
          String(form.get("firstName") ?? "")
            .trim()
            .slice(0, 255) || null;
        const lastName =
          String(form.get("lastName") ?? "")
            .trim()
            .slice(0, 255) || null;
        const slugs = [
          ...new Set(
            form
              .getAll("lists")
              .filter((value): value is string => typeof value === "string"),
          ),
        ];
        const selectedLists = lists.filter((list) => slugs.includes(list.slug));
        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          selectedLists.length !== slugs.length ||
          slugs.length === 0
        ) {
          return context.render(
            <SubscribePage
              lists={lists}
              enabled
              error="Enter a valid email and select at least one list."
            />,
            { status: 400 },
          );
        }
        const subscriber = createSubscriber(
          db,
          email,
          firstName,
          lastName,
          slugs,
        );
        const domains = await sendSubscriptionConfirmations(
          config,
          subscriber,
          selectedLists,
        );
        return context.render(
          <ConfirmationSentPage email={email} domains={domains} />,
        );
      },
    },
  });
  router.map(routes.subscribe, controller);
  router.map(
    routes.confirm,
    createController(routes.confirm, {
      actions: {
        domain(context) {
          const ok = confirmSubscriberDomain(
            db,
            context.params.token,
            context.params.domain,
          );
          return context.render(
            ok ? (
              <StatusPage
                title="Confirmed"
                message={`Your ${context.params.domain} subscriptions have been confirmed.`}
              />
            ) : (
              <StatusPage
                title="Invalid link"
                message="This confirmation link is invalid or has expired."
              />
            ),
            { status: ok ? 200 : 400 },
          );
        },
        all(context) {
          const ok = confirmSubscriber(db, context.params.token);
          return context.render(
            ok ? (
              <StatusPage
                title="Confirmed"
                message="Your subscription has been confirmed."
              />
            ) : (
              <StatusPage
                title="Invalid link"
                message="This confirmation link is invalid or has expired."
              />
            ),
            { status: ok ? 200 : 400 },
          );
        },
      },
    }),
  );
  router.map(
    routes.unsubscribe,
    createController(routes.unsubscribe, {
      actions: {
        list(context) {
          const id = Number(context.params.listId);
          if (!Number.isSafeInteger(id) || id <= 0)
            return new Response("Bad Request", { status: 400 });
          const list = db
            .select()
            .from(schema.lists)
            .where(eq(schema.lists.id, id))
            .get();
          const ok = unsubscribeFromList(db, context.params.token, id);
          const otherActive =
            getSubscriberPreferences(db, context.params.token)?.lists.filter(
              (entry) => entry.subscriptionStatus === "confirmed",
            ).length ?? 0;
          return context.render(
            ok ? (
              <StatusPage
                title="Unsubscribed"
                message={`You have been unsubscribed from ${list?.name ?? "this list"}.${otherActive ? ` You are still subscribed to ${otherActive} other ${otherActive === 1 ? "list" : "lists"}.` : ""}`}
                link={{
                  href: routes.preferences.show.href({
                    token: context.params.token,
                  }),
                  label: "Manage all your subscriptions",
                }}
              />
            ) : (
              <StatusPage
                title="Invalid link"
                message="This unsubscribe link is invalid."
              />
            ),
            { status: ok ? 200 : 400 },
          );
        },
        oneClickList(context) {
          const id = Number(context.params.listId);
          if (!Number.isSafeInteger(id) || id <= 0)
            return new Response("Bad Request", { status: 400 });
          unsubscribeFromList(db, context.params.token, id);
          return new Response("Unsubscribed");
        },
        all(context) {
          const ok = unsubscribeAll(db, context.params.token);
          return context.render(
            ok ? (
              <StatusPage
                title="Unsubscribed"
                message="You have been unsubscribed from all lists."
                link={{
                  href: routes.preferences.show.href({
                    token: context.params.token,
                  }),
                  label: "Changed your mind? Manage your subscriptions",
                }}
              />
            ) : (
              <StatusPage
                title="Invalid link"
                message="This unsubscribe link is invalid."
              />
            ),
            { status: ok ? 200 : 400 },
          );
        },
        oneClickAll(context) {
          unsubscribeAll(db, context.params.token);
          return new Response("Unsubscribed");
        },
      },
    }),
  );
  router.map(
    routes.preferences,
    createController(routes.preferences, {
      actions: {
        show(context) {
          const preferences = getSubscriberPreferences(
            db,
            context.params.token,
          );
          return context.render(
            preferences ? (
              <PreferencesPage
                token={context.params.token}
                preferences={preferences}
              />
            ) : (
              <StatusPage
                title="Invalid link"
                message="This preferences link is invalid."
              />
            ),
            { status: preferences ? 200 : 400 },
          );
        },
        async update(context) {
          const form = await context.request.formData();
          const ids = form
            .getAll("listIds")
            .map(Number)
            .filter((id) => Number.isSafeInteger(id) && id > 0);
          updatePreferences(db, context.params.token, ids);
          return new Response(null, {
            status: 303,
            headers: {
              Location: routes.preferences.show.href({
                token: context.params.token,
              }),
            },
          });
        },
      },
    }),
  );
  return router;
}
