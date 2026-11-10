import { createController } from "remix/router";
import { routes } from "./routes";
import { GurgurPage } from "./page";

export default createController(routes, {
  actions: {
    world(context) {
      return context.render(<GurgurPage />);
    },
  },
});
