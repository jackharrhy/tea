import { createController } from "remix/router";
import { BurgerPage } from "./page.tsx";
import { AtlasPage } from "./atlas/page.tsx";
import { routes } from "./routes.ts";

export default createController(routes, {
  actions: {
    home(context) {
      return context.render(<BurgerPage />);
    },
    atlas(context) {
      return context.render(<AtlasPage />);
    },
  },
});
