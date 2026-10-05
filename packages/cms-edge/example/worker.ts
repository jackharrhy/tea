import { createEdgeRouter, type EdgeConfig } from "@tea/cms-edge";
import { createLogger } from "@tea/logger";

const logger = createLogger({ service: "cms-edge-example" });

const config: EdgeConfig = {
  siteName: "Example TeaCMS site",
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
  fetch(request: Request, env: Env) {
    return logger.request(request, () =>
      createEdgeRouter(env, config).fetch(request),
    );
  },
};
