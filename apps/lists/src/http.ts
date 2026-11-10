import { Elysia } from "elysia";
import { html } from "@elysia/html";

type HttpUser = {
  id: number;
  email: string;
  name: string | null;
  passwordHash: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
};

export function createHttpApp() {
  const app = new Elysia()
    .use(html())
    .onError(({ code, error }) => {
      const status = "status" in error ? error.status : 500;
      if (code === "INTERNAL_SERVER_ERROR" || status >= 500)
        console.error(error);
    })
    .derive(() => ({
      user: null as HttpUser | null,
    }))
    .decorate({
      text: (body: string, status = 200) => new Response(body, { status }),
      json: (body: unknown, status = 200) => Response.json(body, { status }),
      notFound: () => new Response("Not Found", { status: 404 }),
    });

  return Object.assign(app, {
    request: (path: string, init?: RequestInit) =>
      app.handle(new Request(new URL(path, "http://localhost"), init)),
  });
}

export type App = ReturnType<typeof createHttpApp>;
