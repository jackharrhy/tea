import { css, type Handle } from "remix/component";
import { Document } from "./document.js";
import { routes } from "../routes.js";
import type { Service } from "../services.js";

const page = css({
  width: "calc(100% - 32px)",
  maxWidth: "280px",
  margin: "32px auto 40px",
  textAlign: "center",
});
const face = css({
  display: "block",
  width: "180px",
  maxWidth: "100%",
  height: "auto",
  margin: "0 auto 24px",
});
const list = css({
  display: "grid",
  gap: "8px",
  listStyle: "none",
  padding: 0,
  margin: 0,
});
const button = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  minHeight: "44px",
  padding: "10px 16px",
  font: "inherit",
  lineHeight: 1.5,
  color: "#171717",
  background: "#fafafa",
  border: "1px solid #aaa",
  borderRadius: "4px",
  cursor: "pointer",
  "&:hover": { background: "#eee", borderColor: "#777" },
  "&:active": { background: "#e5e5e5" },
});
const logout = css({
  minHeight: "44px",
  marginTop: "12px",
  padding: "8px 12px",
  font: "inherit",
  fontSize: "14px",
  color: "#555",
  background: "transparent",
  border: 0,
  cursor: "pointer",
  textDecoration: "underline",
  textUnderlineOffset: "3px",
});

export type HomePageProps = {
  csrf: string;
  signedIn: boolean;
  items: Service[];
  error?: string;
  unavailable?: boolean;
};
export function HomePage(handle: Handle<HomePageProps>) {
  return () => {
    const input = handle.props;
    return (
      <Document>
        <main mix={page} aria-label="rotund.org">
          <img
            mix={face}
            src="/rotund.png"
            width="400"
            height="600"
            alt="The rotund face"
          />
          {input.unavailable ? (
            <div role="alert">
              <p>Access check failed.</p>
              <a mix={button} href={routes.home.href()}>
                Retry
              </a>
            </div>
          ) : input.signedIn ? (
            <>
              {input.items.length ? (
                <nav aria-label="Services">
                  <ul mix={list}>
                    {input.items.map((item) => (
                      <li key={item.id}>
                        <a mix={button} href={item.url}>
                          {item.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              ) : (
                <p>No services assigned.</p>
              )}
            </>
          ) : (
            <>
              {input.error ? <p role="alert">{input.error}</p> : null}
              <form action={routes.auth.login.href()} method="post">
                <input type="hidden" name="csrf" value={input.csrf} />
                <button mix={button} type="submit">
                  Sign in
                </button>
              </form>
            </>
          )}
          {input.signedIn ? (
            <form action={routes.auth.logout.href()} method="post">
              <input type="hidden" name="csrf" value={input.csrf} />
              <button mix={logout} type="submit">
                Sign out
              </button>
            </form>
          ) : null}
        </main>
      </Document>
    );
  };
}
