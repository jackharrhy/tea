import { compression } from "remix/middleware/compression";
import { staticFiles } from "remix/middleware/static";
import { createRouter, type RouterContext } from "remix/router";

import controller from "./actions/controller.tsx";
import apiController from "./actions/api/controller.ts";
import apiCliController from "./actions/api/cli/controller.ts";
import authController from "./actions/auth/controller.ts";
import settingsController from "./actions/settings/controller.tsx";
import folderController from "./actions/folder/controller.tsx";
import adminController from "./actions/admin/controller.tsx";
import adminJobsController from "./actions/admin/jobs/controller.tsx";
import adminScanSettingsController from "./actions/admin/scan-settings/controller.tsx";
import adminImportController from "./actions/admin/import/controller.tsx";
import adminInboxController from "./actions/admin/inbox/controller.tsx";
import adminArchivesController from "./actions/admin/archives/controller.tsx";
import adminOrphansController from "./actions/admin/orphans/controller.tsx";
import devController from "./actions/dev/controller.tsx";
import mcpController from "./actions/mcp/controller.ts";
import { loadUser } from "./middleware/auth.ts";
import { render } from "./middleware/render.tsx";
import { routes } from "./routes.ts";

export const router = createRouter({
  middleware: [
    compression(),
    staticFiles(process.env.ARTBIN_PUBLIC_DIR ?? "./public", {
      index: false,
      filter: (path) => {
        const segments = path.split("/").filter(Boolean);
        return (
          segments[0] !== "uploads" &&
          !segments.some((segment) => segment.startsWith("."))
        );
      },
    }),
    loadUser(),
    render(),
  ],
});

export type AppContext = RouterContext<typeof router>;

declare module "remix/router" {
  interface RouterTypes {
    context: AppContext;
  }
}

router.map(routes, controller);
router.map(routes.auth, authController);
router.map(routes.settings, settingsController);
router.map(routes.folder, folderController);
router.map(routes.dev, devController);
router.map(routes.mcp, mcpController);
router.map(routes.admin, adminController);
router.map(routes.admin.jobs, adminJobsController);
router.map(routes.admin.scanSettings, adminScanSettingsController);
router.map(routes.admin.import, adminImportController);
router.map(routes.admin.inbox, adminInboxController);
router.map(routes.admin.archives, adminArchivesController);
router.map(routes.admin.orphans, adminOrphansController);
router.map(routes.api, apiController);
router.map(routes.api.cli, apiCliController);
