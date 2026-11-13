import { createController } from "remix/router";
import { getCspNonce } from "remix/middleware/csp";
import { BurgerPage } from "./page.tsx";
import { AtlasPage } from "./atlas/page.tsx";
import { routes } from "./routes.ts";

export default createController(routes, {
  actions: {
    home(context) {
      return context.render(<BurgerPage nonce={getCspNonce(context)} />);
    },
    atlas(context) {
      return context.render(<AtlasPage nonce={getCspNonce(context)} />);
    },
  },
});
