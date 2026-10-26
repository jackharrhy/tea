import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { css } from "remix/component";

import { assetServer } from "../assets.ts";
import { routes } from "../routes.ts";
import { Document } from "./document.tsx";
import { loadFoldersPage } from "../data/folders-page.ts";
import { FoldersPage } from "./folders-page.tsx";
import { loadFilePage } from "../data/file-page.ts";
import { FileRoutePage } from "./file-page.tsx";
import { loadMyUploadsPage } from "../data/my-uploads-page.ts";
import { MyUploadsPage } from "./my-uploads-page.tsx";
import { Alert, ButtonLink } from "../ui/primitives.tsx";
import { mutedTextStyle, theme } from "../ui/styles.ts";
import { serveFolderPreview, serveMediaFile } from "./media.ts";
import { CliPage } from "./cli-page.tsx";

const loginPageStyle = css({
  backgroundColor: theme.color.background,
  border: `1px solid ${theme.color.border}`,
  margin: "4rem auto 0",
  maxWidth: "360px",
  padding: "2rem",
});
const loginTitleStyle = css({
  fontSize: "1.25rem",
  margin: "0 0 1.5rem",
  textAlign: "center",
});
const loginNoteStyle = css({
  fontSize: "0.875rem",
  margin: "1rem 0 0",
  textAlign: "center",
});

export default createController(routes, {
  actions: {
    async assets({ request }) {
      return (
        (await assetServer.fetch(request)) ??
        new Response("Not Found", { status: 404 })
      );
    },
    mediaFile({ request, params, user }) {
      return serveMediaFile({
        request,
        fileId: params.fileId,
        filename: params.filename,
        user,
      });
    },
    mediaFolderPreview({ request, params, user }) {
      return serveFolderPreview({
        request,
        folderId: params.folderId,
        filename: params.filename,
        user,
      });
    },
    home(context) {
      return redirect(
        context.user ? routes.folders.href() : routes.login.href(),
        302,
      );
    },
    cli(context) {
      return context.render(<CliPage user={context.user} />);
    },
    async login(context) {
      const user = context.user;
      if (user) return redirect(routes.folders.href(), 302);

      const errorParam = context.url.searchParams.get("error");
      const errorMessage =
        errorParam === "access_denied"
          ? "Authorization was denied"
          : errorParam
            ? "Login failed. Please try again."
            : null;

      return context.render(
        <Document title="Login - artbin">
          <main mix={loginPageStyle}>
            <h1 mix={loginTitleStyle}>Login</h1>
            {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
            <ButtonLink
              href={routes.auth.login.href()}
              variant="primary"
              block
              document
            >
              Sign in with Jack Auth
            </ButtonLink>
            <p mix={[loginNoteStyle, mutedTextStyle]}>
              Use your Jack Auth account.
            </p>
            <p mix={loginNoteStyle}>
              Uploading with the CLI?{" "}
              <a href={routes.cli.href()}>Read the guide</a>.
            </p>
          </main>
        </Document>,
      );
    },
    async myUploads(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const data = await loadMyUploadsPage(context.url, context.user.id);
      return context.render(<MyUploadsPage data={data} user={context.user} />);
    },
    async folders(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const data = await loadFoldersPage(context.url);
      if (context.request.headers.get("accept") === "application/json") {
        return Response.json(
          data.searchResults ?? { files: [], nextCursor: null },
          {
            headers: { Vary: "Accept", "Cache-Control": "private, no-store" },
          },
        );
      }
      return context.render(<FoldersPage data={data} user={context.user} />, {
        headers: { Vary: "Accept" },
      });
    },
    async file(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const data = await loadFilePage(context.params.path, context.user);
      if (!data) return new Response("File not found", { status: 404 });
      if (data.page === "wad-redirect") {
        return redirect(routes.folder.index.href({ path: data.path }), 302);
      }
      return context.render(<FileRoutePage data={data} user={context.user} />);
    },
  },
});
