import { createRouter } from "remix/router";
import { get, route } from "remix/routes";

const routes = route({
  health: get("/healthz"),
  styles: get("/assets/style.css"),
  font: get("/assets/fonts/inter-variable.woff2"),
  doodleMotion: get("/assets/doodle-motion.mjs"),
  doodleWebgl: get("/assets/doodle-webgl.mjs"),
  doodleSpec: get("/assets/doodle-spec.mjs"),
});

const common = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

export function createPublicRouter({ styles, font, doodles }) {
  const router = createRouter();
  router.map(routes, {
    actions: {
      health() {
        return new Response("ok", { headers: common });
      },
      styles() {
        return new Response(styles, {
          headers: { ...common, "Content-Type": "text/css; charset=utf-8" },
        });
      },
      font() {
        return new Response(font, {
          headers: {
            ...common,
            "Cache-Control": "public, max-age=86400",
            "Content-Type": "font/woff2",
          },
        });
      },
      doodleMotion() {
        return script(doodles.get("/assets/doodle-motion.mjs"));
      },
      doodleWebgl() {
        return script(doodles.get("/assets/doodle-webgl.mjs"));
      },
      doodleSpec() {
        return script(doodles.get("/assets/doodle-spec.mjs"));
      },
    },
  });
  return router;
}

function script(body) {
  return new Response(body, {
    headers: { ...common, "Content-Type": "text/javascript; charset=utf-8" },
  });
}

export function isPublicRoute(path) {
  return path === "/healthz" || path.startsWith("/assets/");
}
