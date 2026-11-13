import { createRouter, type MiddlewareContext } from "remix/router";
import { render } from "remix/middleware/render";
import { asyncContext } from "remix/middleware/async-context";
import { csp } from "remix/middleware/csp";
import { staticFiles } from "remix/middleware/static";

import controller from "./actions/controller.tsx";
import steveController from "./actions/steve/controller.tsx";
import centralAuthController from "./actions/steve/central-auth-controller.ts";
import uploadsController from "./actions/uploads/controller.ts";
import { assets } from "./assets.ts";
import { AttachmentStore } from "./data/attachment-store.ts";
import { createLettersDatabase } from "./data/database.ts";
import { loadAttachmentStore } from "./middleware/attachments.ts";
import { loadDatabase } from "./middleware/database.ts";
import { routes } from "./routes.ts";

const renderMiddleware = render({ assets });
const asyncContextMiddleware = asyncContext();
const htmlNoStore = async (
  _context: unknown,
  next: () => Promise<Response>,
) => {
  const response = await next();
  if (response.headers.get("Content-Type")?.startsWith("text/html"))
    response.headers.set("Cache-Control", "private, no-store");
  return response;
};
const cspMiddleware = csp({
  policy: ({ nonce }) => ({
    defaultSrc: ["'none'"],
    scriptSrc: ["'self'", `'nonce-${nonce}'`],
    styleSrc: ["'self'", `'nonce-${nonce}'`],
    fontSrc: ["'self'"],
    imgSrc: ["'self'", "blob:", "data:"],
    connectSrc: ["'self'"],
    formAction: ["'self'"],
    baseUri: ["'none'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
  }),
});

export async function createAppRouter(
  options: { databasePath?: string; uploadDirectory?: string } = {},
) {
  let database = await createLettersDatabase(options.databasePath);
  let attachmentStore = new AttachmentStore(
    database,
    options.uploadDirectory ?? process.env.UPLOAD_DIRECTORY ?? "./tmp/uploads",
  );
  await attachmentStore.initialize();
  let databaseMiddleware = loadDatabase(database);
  let attachmentStoreMiddleware = loadAttachmentStore(attachmentStore);
  let staticMiddleware = staticFiles("./public", {
    cacheControl:
      process.env.NODE_ENV === "production"
        ? "public, max-age=604800"
        : "no-cache",
    index: false,
  });

  let middleware = [
    staticMiddleware,
    htmlNoStore,
    asyncContextMiddleware,
    databaseMiddleware,
    attachmentStoreMiddleware,
    cspMiddleware,
    renderMiddleware,
  ] as const;

  type LocalAppContext = MiddlewareContext<typeof middleware>;

  let appRouter = createRouter<LocalAppContext>({ middleware });
  appRouter.map(routes, controller);
  appRouter.map(routes.uploads, uploadsController);
  appRouter.map(routes.steve, steveController);
  appRouter.map(routes.auth, centralAuthController);

  return { attachmentStore, database, router: appRouter };
}

type AppContext = MiddlewareContext<
  [
    ReturnType<typeof staticFiles>,
    typeof htmlNoStore,
    typeof asyncContextMiddleware,
    ReturnType<typeof loadDatabase>,
    ReturnType<typeof loadAttachmentStore>,
    typeof cspMiddleware,
    typeof renderMiddleware,
  ]
>;

declare module "remix/router" {
  interface RouterTypes {
    context: AppContext;
  }
}

export const { database, router } = await createAppRouter({
  databasePath: process.env.NODE_ENV === "test" ? ":memory:" : undefined,
});
