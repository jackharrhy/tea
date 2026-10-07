import {
  createEdgeRouter,
  type Bindings,
  type EdgeConfig,
} from "./app/index.tsx";
import { createLogger } from "@tea/logger";

const logger = createLogger({ service: "cms-edge" });

const config: EdgeConfig = {
  siteName: "TeaCMS Edge",
  collections: [
    {
      name: "pages",
      label: "Pages",
      fields: [
        { name: "title", label: "Title", type: "text", required: true },
        { name: "body", label: "Body", type: "textarea" },
      ],
    },
  ],
};

export default {
  fetch(request: Request, env: Bindings) {
    return logger.request(request, () =>
      createEdgeRouter(env, config).fetch(request),
    );
  },
};
