import { createEdgeRouter, type EdgeConfig } from "@teacms/edge";

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
    return createEdgeRouter(env, config).fetch(request);
  },
};
