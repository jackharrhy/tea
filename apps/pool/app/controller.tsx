import { createController } from "remix/router";
import { getCspNonce } from "remix/middleware/csp";
import { PoolPage } from "./page.tsx";
import { routes } from "./routes.ts";

export default createController(routes, {
  actions: {
    home(context) {
      return context.render(<PoolPage nonce={getCspNonce(context)} />);
    },
  },
});
