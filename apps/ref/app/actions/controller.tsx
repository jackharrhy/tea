import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import {
  AppPassword,
  AppRuntime,
  Authenticated,
  CurrentSessionToken,
} from "../data/runtime.ts";
import { samePassword, tokenHash } from "../data/crypto.ts";
import { sessionCookie, clearSessionCookie } from "../middleware/session.ts";
import { routes } from "../routes.ts";
import { AuthPage, HomePage } from "./page.tsx";

export default createController(routes, {
  actions: {
    async home(context) {
      const error =
        new URL(context.request.url).searchParams.get("error") ?? undefined;
      if (!context.get(Authenticated))
        return context.render(<AuthPage error={error} />);
      const boards = await context.get(AppRuntime)!.directory.listBoards();
      return context.render(<HomePage boards={boards} error={error} />);
    },
    async login(context) {
      const form = context.get(FormData)!;
      const runtime = context.get(AppRuntime)!;
      // Celld supplies an empty cf object; only Cloudflare sets colo and owns this header.
      const address = context.request.cf?.colo
        ? context.request.headers.get("CF-Connecting-IP")
        : null;
      const client =
        address && /^[0-9a-f:.]{3,45}$/i.test(address) ? address : null;
      const clientHash = client ? await tokenHash(client) : null;
      if (clientHash) {
        const retryAfter =
          await runtime.directory.consumeLoginAttempt(clientHash);
        if (retryAfter) {
          return redirect("/?error=Too+many+attempts.+Try+again+shortly", {
            status: 303,
            headers: { "Retry-After": String(retryAfter) },
          });
        }
      }
      if (
        !(await samePassword(
          String(form.get("password") ?? ""),
          context.get(AppPassword)!,
        ))
      ) {
        return redirect("/?error=Incorrect+password", 303);
      }
      if (clientHash) await runtime.directory.clearLoginAttempts(clientHash);
      const token = await runtime.directory.createSession();
      return redirect("/", {
        status: 303,
        headers: { "Set-Cookie": sessionCookie(token, context.request) },
      });
    },
    async logout(context) {
      const token = context.get(CurrentSessionToken);
      const runtime = context.get(AppRuntime)!;
      if (token) {
        await runtime.directory.endSession(token);
        const hash = await tokenHash(token);
        const boards = await runtime.directory.listBoards();
        await Promise.allSettled(
          boards.map((board) => runtime.board(board.id).closeSession(hash)),
        );
      }
      return redirect("/", {
        status: 303,
        headers: {
          "Set-Cookie": clearSessionCookie(context.request),
          "Clear-Site-Data": '"cache"',
        },
      });
    },
  },
});
