import { css, type Handle } from "remix/component";

import type { User } from "#db";

import { Page } from "../ui/page.tsx";
import { pageStyle, theme } from "../ui/styles.ts";

const shellStyle = css({
  marginInline: "auto",
  maxWidth: "1120px",
  paddingBottom: "6rem",
});
const heroStyle = css({
  alignItems: "end",
  borderBottom: `1px solid ${theme.color.border}`,
  display: "grid",
  gap: "3rem",
  gridTemplateColumns: "minmax(0, 1fr) minmax(20rem, 0.9fr)",
  padding: "3.5rem 0 3rem",
  scrollMarginTop: "4rem",
  "@media (max-width: 760px)": {
    gap: "2rem",
    gridTemplateColumns: "1fr",
    padding: "2rem 0",
  },
});
const titleStyle = css({
  fontSize: "clamp(2.6rem, 5vw, 4rem)",
  fontWeight: 400,
  letterSpacing: "-0.045em",
  lineHeight: 1.05,
  margin: "0 0 1.2rem",
});
const introStyle = css({
  fontSize: "1.25rem",
  lineHeight: 1.45,
  margin: "0 0 1.4rem",
  maxWidth: "29rem",
});
const requirementStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  lineHeight: 1.5,
  margin: 0,
});
const quickStartStyle = css({
  backgroundColor: "#202020",
  color: "#f7f7f7",
  padding: "1.25rem 1.5rem 1.5rem",
});
const quickStartTitleStyle = css({
  borderBottom: "1px solid #5e5e5e",
  fontFamily: theme.font.mono,
  fontSize: "0.75rem",
  fontWeight: 400,
  margin: "0 0 1.25rem",
  paddingBottom: "0.75rem",
});
const quickStartCodeStyle = css({
  fontFamily: theme.font.mono,
  fontSize: "0.875rem",
  lineHeight: 1.8,
  margin: 0,
  overflowX: "auto",
});
const quickStartNoteStyle = css({
  color: "#d7d7d7",
  fontSize: "0.875rem",
  lineHeight: 1.5,
  margin: "1.3rem 0 0",
  "& code": { color: "#fff", fontFamily: theme.font.mono, fontSize: "0.9em" },
});
const layoutStyle = css({
  display: "grid",
  gap: "4rem",
  gridTemplateColumns: "10rem minmax(0, 1fr)",
  paddingTop: "2.5rem",
  "@media (max-width: 760px)": {
    gap: "2.25rem",
    gridTemplateColumns: "1fr",
    paddingTop: "1.5rem",
  },
});
const navStyle = css({
  alignSelf: "start",
  position: "sticky",
  top: "5rem",
  "@media (max-width: 760px)": { position: "static" },
});
const navTitleStyle = css({
  color: theme.color.muted,
  fontFamily: theme.font.mono,
  fontSize: "0.75rem",
  margin: "0 0 0.8rem",
});
const navListStyle = css({
  display: "flex",
  flexDirection: "column",
  gap: "0.7rem",
  listStyle: "none",
  margin: 0,
  padding: 0,
  "& a": { fontSize: "0.875rem", textDecoration: "none" },
  "& a:hover": { textDecoration: "underline" },
  "& a:focus-visible": {
    outline: `2px solid ${theme.color.text}`,
    outlineOffset: "3px",
  },
  "@media (max-width: 760px)": {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: "0.7rem 1.25rem",
  },
});
const articleStyle = css({ minWidth: 0 });
const methodGridStyle = css({
  display: "grid",
  gap: "2rem",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  "@media (max-width: 1080px)": { gridTemplateColumns: "1fr" },
});
const methodStyle = css({
  borderTop: `2px solid ${theme.color.border}`,
  paddingTop: "1.25rem",
  scrollMarginTop: "5rem",
});
const sectionStyle = css({
  borderTop: `1px solid ${theme.color.borderLight}`,
  marginTop: "3rem",
  paddingTop: "2rem",
  scrollMarginTop: "5rem",
});
const headingStyle = css({
  fontSize: "1.65rem",
  fontWeight: 400,
  margin: "0 0 0.6rem",
});
const paragraphStyle = css({
  lineHeight: 1.6,
  margin: "0.65rem 0 0",
  maxWidth: "42rem",
});
const codeStyle = css({
  backgroundColor: theme.color.page,
  fontFamily: theme.font.mono,
  fontSize: "0.82rem",
  lineHeight: 1.75,
  margin: "1.25rem 0",
  overflowX: "auto",
  padding: "1rem 1.2rem",
  whiteSpace: "pre",
  "@media (max-width: 760px)": {
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
  },
});
const inlineCodeStyle = css({
  backgroundColor: theme.color.page,
  fontFamily: theme.font.mono,
  fontSize: "0.875em",
  padding: "0.08em 0.25em",
});
const noteStyle = css({
  backgroundColor: theme.color.page,
  borderLeft: `3px solid ${theme.color.border}`,
  marginTop: "3rem",
  padding: "1.25rem 1.5rem",
  scrollMarginTop: "5rem",
});
const noteHeadingStyle = css({
  fontSize: "1.25rem",
  fontWeight: 400,
  margin: 0,
});

export function CliPage(handle: Handle<{ user: Pick<User, "username" | "isAdmin"> | null }>) {
  return () => (
    <Page title="CLI guide - artbin" user={handle.props.user}>
      <main mix={pageStyle}>
        <div mix={shellStyle}>
          <section id="install" mix={heroStyle}>
            <div>
              <h1 mix={titleStyle}>artbin CLI</h1>
              <p mix={introStyle}>
                Upload a directory, import game assets, or download a folder from your terminal.
              </p>
              <p mix={requirementStyle}>Requires Node.js 20 or newer.</p>
            </div>
            <div mix={quickStartStyle}>
              <h2 mix={quickStartTitleStyle}>Install and sign in</h2>
              <pre mix={quickStartCodeStyle}>
                <code>{"npm install --global artbin\nartbin login"}</code>
              </pre>
              <p mix={quickStartNoteStyle}>
                Login opens your browser. The default server is <code>artbin.jackharrhy.dev</code>.
                For another server, run <code>artbin login &lt;server-url&gt;</code>.
              </p>
            </div>
          </section>

          <div mix={layoutStyle}>
            <nav mix={navStyle} aria-label="CLI guide sections">
              <p mix={navTitleStyle}>On this page</p>
              <ul mix={navListStyle}>
                <li>
                  <a href="#install">Install</a>
                </li>
                <li>
                  <a href="#upload">Upload files</a>
                </li>
                <li>
                  <a href="#import">Import game assets</a>
                </li>
                <li>
                  <a href="#browse">Browse and download</a>
                </li>
                <li>
                  <a href="#organize">Organize folders</a>
                </li>
                <li>
                  <a href="#uploads">Upload behavior</a>
                </li>
              </ul>
            </nav>

            <article mix={articleStyle}>
              <div mix={methodGridStyle}>
                <section id="upload" mix={methodStyle}>
                  <h2 mix={headingStyle}>Upload files</h2>
                  <p mix={paragraphStyle}>
                    Use <code mix={inlineCodeStyle}>add</code> for a directory of files. It keeps
                    the directory structure and skips dotfiles and{" "}
                    <code mix={inlineCodeStyle}>node_modules</code>.
                  </p>
                  <pre mix={codeStyle}>
                    <code>{"artbin add ./my-files --dry-run\nartbin add ./my-files"}</code>
                  </pre>
                  <p mix={paragraphStyle}>
                    The directory name becomes the Artbin folder name. Use{" "}
                    <code mix={inlineCodeStyle}>--folder &lt;slug&gt;</code> to choose another. A
                    dry run previews local files without a login or server connection. It does not
                    check which files are already on Artbin.
                  </p>
                </section>

                <section id="import" mix={methodStyle}>
                  <h2 mix={headingStyle}>Import game assets</h2>
                  <p mix={paragraphStyle}>
                    Use <code mix={inlineCodeStyle}>scan</code> to inspect a game directory, then{" "}
                    <code mix={inlineCodeStyle}>import</code> to upload supported assets, including
                    files found in archives.
                  </p>
                  <pre mix={codeStyle}>
                    <code>
                      {"artbin scan ./game\nartbin import ./game --dry-run\nartbin import ./game"}
                    </code>
                  </pre>
                  <p mix={paragraphStyle}>
                    <code mix={inlineCodeStyle}>import</code> also accepts{" "}
                    <code mix={inlineCodeStyle}>--folder &lt;slug&gt;</code>. Its dry run works
                    offline and reports the source size; extracted files may have a different total
                    size.
                  </p>
                </section>
              </div>

              <section id="browse" mix={sectionStyle}>
                <h2 mix={headingStyle}>Browse and download</h2>
                <p mix={paragraphStyle}>
                  You can inspect and download public folders with any Artbin account.{" "}
                  <code mix={inlineCodeStyle}>pull</code> downloads a folder ZIP.
                </p>
                <pre mix={codeStyle}>
                  <code>
                    {
                      "artbin folders list\nartbin folders show <slug>\nartbin pull <slug> [destination]"
                    }
                  </code>
                </pre>
                <p mix={paragraphStyle}>
                  Optional flags include <code mix={inlineCodeStyle}>--tree</code>,{" "}
                  <code mix={inlineCodeStyle}>--all</code>,{" "}
                  <code mix={inlineCodeStyle}>--json</code>, and{" "}
                  <code mix={inlineCodeStyle}>--force</code>.
                </p>
              </section>

              <section id="organize" mix={sectionStyle}>
                <h2 mix={headingStyle}>Organize folders</h2>
                <p mix={paragraphStyle}>
                  Only administrators can create, rename, or move folders. Rename and move show a
                  preview before confirmation.
                </p>
                <pre mix={codeStyle}>
                  <code>
                    {
                      "artbin folders rename <slug> <new-name>\nartbin folders move <slug> --to <destination-or-root>\nartbin logout"
                    }
                  </code>
                </pre>
                <p mix={paragraphStyle}>
                  Use <code mix={inlineCodeStyle}>--dry-run</code> to preview without changing
                  anything, <code mix={inlineCodeStyle}>--yes</code> to skip confirmation, or{" "}
                  <code mix={inlineCodeStyle}>--json</code> for scripts.
                </p>
              </section>

              <aside id="uploads" mix={noteStyle}>
                <h2 mix={noteHeadingStyle}>Upload behavior</h2>
                <p mix={paragraphStyle}>
                  Regular-user uploads go to the review inbox. The CLI retries transient transfer
                  failures during a run. Rerunning a command skips files already indexed with the
                  same size and checksum. It reports conflicts instead of overwriting files. Files
                  may be up to 512 MiB each.
                </p>
              </aside>
            </article>
          </div>
        </div>
      </main>
    </Page>
  );
}
