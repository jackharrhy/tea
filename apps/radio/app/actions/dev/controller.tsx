import { createController } from "remix/router";

import { routes } from "../../routes.ts";
import { KitchenSinkPage } from "./kitchen-sink-page.tsx";

export default createController(routes.dev, {
  actions: {
    kitchenSink(context) {
      if (process.env.NODE_ENV === "production") {
        return new Response("Not Found", { status: 404 });
      }

      return context.render(<KitchenSinkPage />);
    },
  },
});
