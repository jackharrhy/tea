import { createController } from "remix/router";

import { action as manageFolder } from "../handlers/api.cli.folder.manage.ts";
import {
  action as createFolders,
  loader as listFolders,
} from "../handlers/api.cli.folders.ts";
import { action as manifest } from "../handlers/api.cli.manifest.ts";
import { loader as whoami } from "../handlers/api.cli.whoami.ts";
import { routes } from "../../../routes.ts";

export default createController(routes.api.cli, {
  actions: {
    whoami({ request }) {
      return whoami({ request });
    },
    foldersGet({ request }) {
      return listFolders({ request });
    },
    foldersPost({ request }) {
      return createFolders({ request });
    },
    folderManage({ request }) {
      return manageFolder({ request });
    },
    manifest({ request }) {
      return manifest({ request });
    },
  },
});
