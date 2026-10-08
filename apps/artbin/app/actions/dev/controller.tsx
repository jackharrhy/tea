import { createController } from "remix/router";

import { routes } from "../../routes.ts";
import { KitchenSinkPage } from "./kitchen-sink-page.tsx";

export default createController(routes.dev, {
  actions: {
    kitchenSink(context) {
      return context.render(<KitchenSinkPage user={context.user} />);
    },
  },
});
