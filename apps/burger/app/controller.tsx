import { createController } from "remix/router";
import { BurgerPage } from "./page.tsx";
import { routes } from "./routes.ts";

export default createController(routes, {
  actions: {
    home(context) {
      return context.render(<BurgerPage />);
    },
  },
});
