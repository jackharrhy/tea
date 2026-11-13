import { createController } from "remix/router";
import { getCspNonce } from "remix/middleware/csp";
import { routes } from "./routes";
import { GurgurPage } from "./page";

export default createController(routes, {
  actions: {
    world(context) {
      return context.render(<GurgurPage nonce={getCspNonce(context)} />);
    },
  },
});
